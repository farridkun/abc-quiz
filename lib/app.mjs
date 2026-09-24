import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { GameError, requireThat, validName, newRoom, membership, joinRoom, applyCommand, snapshot } from './game.mjs';

// Stateless request handler. All state lives in two key-value stores that follow
// the Netlify Blobs API subset: getWithMetadata(key, {type:'json'}),
// setJSON(key, value, {onlyIfMatch|onlyIfNew}) -> {modified}, delete(key), list().
// Concurrency uses optimistic ETag checks instead of database transactions.

const hash = value => createHash('sha256').update(value).digest('hex');
export const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
export const ROOM_AGE = 24 * 60 * 60 * 1000;
export const ONLINE_WINDOW = 35000;
const SEEN_REFRESH = 10000;
const HOST_HANDOFF = 60000;
const RECEIPTS = 200;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CONFLICT_RETRIES = 8;

export function createHandler({ sessions, rooms }) {
  const limits = new Map();
  const limited = (key, max, windowMs = 60000) => {
    const now = Date.now();
    if (limits.size > 5000) for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    let state = limits.get(key);
    if (!state || state.until < now) { state = { n: 0, until: now + windowMs }; limits.set(key, state); }
    requireThat(++state.n <= max, 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.', 429, 'rate_limit');
  };

  async function loadRoom(code) {
    const entry = await rooms.getWithMetadata(code, { type: 'json' });
    requireThat(entry?.data && entry.data.updatedAt > Date.now() - ROOM_AGE, 'Ruang tidak ditemukan atau sudah kedaluwarsa.', 404, 'room_missing');
    return entry;
  }
  // Read-modify-write with ETag check. fn mutates the room and returns true to save.
  // It re-runs on a fresh copy whenever another writer got there first.
  async function mutateRoom(code, fn) {
    for (let i = 0; i < CONFLICT_RETRIES; i++) {
      const { data: room, etag } = await loadRoom(code);
      const result = fn(room);
      if (!result) return room;
      const { modified } = await rooms.setJSON(code, room, { onlyIfMatch: etag });
      if (modified) return room;
    }
    throw new GameError('Ruang sedang ramai. Coba lagi sebentar.', 409, 'stale_state');
  }
  async function mutateSession(key, fn) {
    for (let i = 0; i < CONFLICT_RETRIES; i++) {
      const entry = await sessions.getWithMetadata(key, { type: 'json' });
      requireThat(entry?.data, 'Sesi berakhir. Muat ulang dan isi nama kamu kembali.', 401, 'session_expired');
      fn(entry.data);
      if ((await sessions.setJSON(key, entry.data, { onlyIfMatch: entry.etag })).modified) return entry.data;
    }
    throw new GameError('Profil sedang diperbarui. Coba lagi.', 409, 'profile_conflict');
  }
  // Keep the member's cached display name/avatar in sync with their profile.
  function syncMember(room, profile) {
    const m = room.members.find(x => x.id === profile.id);
    if (!m || (m.name === profile.name && m.avatar === profile.avatar)) return false;
    m.name = profile.name; m.avatar = profile.avatar; return true;
  }
  const isOnline = (m, now) => (m.seenAt || 0) > now - ONLINE_WINDOW;

  function cookies(request) {
    return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(s => s.trim().split('=')).filter(p => p.length === 2));
  }
  async function auth(request, headers, create = false) {
    const raw = cookies(request).abc_session;
    const key = raw && /^[a-f0-9]{64}$/.test(raw) ? hash(raw) : null;
    const entry = key && await sessions.getWithMetadata(key, { type: 'json' });
    if (entry?.data && entry.data.expires > Date.now()) return { key, profile: entry.data };
    requireThat(create, 'Sesi berakhir. Muat ulang dan isi nama kamu kembali.', 401, 'session_expired');
    const token = randomBytes(32).toString('hex');
    const profile = { id: randomUUID(), csrf: randomBytes(24).toString('hex'), name: '', avatar: 1, version: 1, expires: Date.now() + SESSION_AGE, rooms: [] };
    await sessions.setJSON(hash(token), profile, { onlyIfNew: true });
    const secure = new URL(request.url).protocol === 'https:';
    headers.append('Set-Cookie', `abc_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_AGE / 1000}${secure ? '; Secure' : ''}`);
    return { key: hash(token), profile };
  }
  function csrf(request, profile) {
    const origin = request.headers.get('origin');
    if (origin) {
      let host; try { host = new URL(origin).host; } catch { throw new GameError('Origin tidak valid.', 403); }
      requireThat(host === new URL(request.url).host, 'Permintaan harus dari aplikasi ini.', 403);
    }
    requireThat(request.headers.get('sec-fetch-site') !== 'cross-site', 'Permintaan lintas situs ditolak.', 403);
    const supplied = Buffer.from(String(request.headers.get('x-csrf-token') || ''));
    const expected = Buffer.from(profile.csrf);
    requireThat(supplied.length === expected.length && timingSafeEqual(supplied, expected), 'Sesi tidak valid. Muat ulang halaman.', 403, 'csrf');
  }
  async function body(request) {
    const raw = await request.text();
    requireThat(Buffer.byteLength(raw) <= 8192, 'Permintaan terlalu besar.', 413);
    try { const value = JSON.parse(raw || '{}'); requireThat(value && typeof value === 'object' && !Array.isArray(value), 'Format data tidak valid.'); return value; }
    catch (err) { if (err instanceof GameError) throw err; throw new GameError('Format JSON tidak valid.'); }
  }
  const publicProfile = p => ({ id: p.id, name: p.name, avatar: p.avatar, version: p.version });
  const rememberRoom = (p, code) => { p.rooms = [code, ...(p.rooms || []).filter(c => c !== code)].slice(0, 20); };

  async function route(request, ip, headers) {
    const url = new URL(request.url);
    const path = url.pathname, method = request.method;
    const json = (value, status = 200) => Response.json(value, { status, headers });
    if (path === '/health') return json({ ok: true });
    limited(`ip:${ip}`, 2000);
    if (method === 'GET' && path === '/api/me') {
      limited(`session:${ip}`, 1500);
      const { profile: p } = await auth(request, headers, true);
      return json({ profile: publicProfile(p), csrf: p.csrf });
    }
    const { key, profile: p } = await auth(request, headers);
    if (!['GET', 'HEAD'].includes(method)) csrf(request, p);
    if (method === 'PATCH' && path === '/api/me') {
      limited(`profile:${p.id}`, 30);
      const data = await body(request);
      const name = validName(data.name), avatar = data.avatar ?? p.avatar;
      requireThat(Number.isInteger(avatar) && avatar >= 1 && avatar <= 12, 'Pilih avatar yang tersedia.');
      const fresh = await mutateSession(key, s => {
        requireThat(s.version === (data.version ?? -1), 'Nama sudah diperbarui di tab lain. Periksa nama terbaru, lalu simpan kembali.', 409, 'profile_conflict');
        s.name = name; s.avatar = avatar; s.version++;
      });
      // Push the new name into every room this profile belongs to so others see it now.
      await Promise.all((fresh.rooms || []).map(code => mutateRoom(code, room => syncMember(room, fresh)).catch(() => {})));
      return json({ profile: publicProfile(fresh) });
    }
    if (method === 'POST' && path === '/api/rooms') {
      limited(`create:${p.id}`, 10);
      requireThat(p.name, 'Isi nama kamu terlebih dahulu.');
      const data = await body(request);
      const title = data.title ? validName(data.title) : 'Ruang rehat';
      for (let i = 0; i < 10; i++) {
        const code = [...randomBytes(6)].map(n => ROOM_ALPHABET[n % ROOM_ALPHABET.length]).join('');
        const room = newRoom(code, p.id, title);
        Object.assign(room.members[0], { name: p.name, avatar: p.avatar, seenAt: Date.now() });
        room.receipts = [];
        if (!(await rooms.setJSON(code, room, { onlyIfNew: true })).modified) continue;
        await mutateSession(key, s => rememberRoom(s, code)).catch(() => {});
        return json({ code }, 201);
      }
      throw new GameError('Belum bisa membuat ruang. Coba lagi.', 500);
    }
    const match = path.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|command))?$/);
    requireThat(match, 'Endpoint tidak ditemukan.', 404);
    const [, code, action] = match;
    if (method === 'POST' && action === 'join') {
      limited(`join:${p.id}`, 30); requireThat(p.name, 'Isi nama kamu terlebih dahulu.');
      await mutateRoom(code, room => {
        joinRoom(room, p.id); syncMember(room, p);
        room.members.find(m => m.id === p.id).seenAt = Date.now();
        return true;
      });
      if (!(p.rooms || []).includes(code)) await mutateSession(key, s => rememberRoom(s, code)).catch(() => {});
      return json({ code });
    }
    if (method === 'GET' && !action) {
      limited(`poll:${p.id}`, 400);
      // Polling doubles as presence: refresh seenAt, sync name, hand host off if gone.
      const room = await mutateRoom(code, room => {
        const me = membership(room, p.id), now = Date.now();
        let changed = syncMember(room, p);
        if (now - (me.seenAt || 0) > SEEN_REFRESH) { me.seenAt = now; changed = true; }
        if (now - room.updatedAt > SEEN_REFRESH * 6) { room.updatedAt = now; changed = true; }
        const host = room.members.find(m => m.id === room.hostId);
        if (host && host.id !== p.id && now - (host.seenAt || room.createdAt) > HOST_HANDOFF) {
          const successor = room.members.filter(m => m.active && isOnline(m, now)).sort((a, b) => a.joinedAt - b.joinedAt)[0];
          if (successor && successor.id !== host.id) { room.hostId = successor.id; room.version++; changed = true; }
        }
        return changed;
      });
      const now = Date.now();
      return json(snapshot(room, p.id, id => room.members.find(m => m.id === id), id => isOnline(room.members.find(m => m.id === id), now)));
    }
    if (method === 'POST' && action === 'command') {
      limited(`command:${p.id}`, 120);
      const data = await body(request);
      requireThat(typeof data.commandId === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(data.commandId), 'Command ID tidak valid.');
      const payload = hash(JSON.stringify(data));
      await mutateRoom(code, room => {
        room.receipts ||= [];
        // Receipts live inside the room document, so they commit atomically with the change.
        const old = room.receipts.find(r => r.id === data.commandId);
        if (old) { requireThat(old.actor === p.id && old.payload === payload, 'Command ID sudah digunakan.', 409); return false; }
        requireThat(room.version === data.version, 'Ruang sudah berubah. Papan diperbarui; coba aksimu kembali.', 409, 'stale_state');
        applyCommand(room, p.id, data.action, data);
        room.members.find(m => m.id === p.id).seenAt = Date.now();
        room.receipts = [{ id: data.commandId, actor: p.id, payload, at: Date.now() }, ...room.receipts].slice(0, RECEIPTS);
        return true;
      });
      return json({ ok: true });
    }
    throw new GameError('Metode tidak tersedia.', 405);
  }

  return async function handle(request, { ip = 'unknown' } = {}) {
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    try { return await route(request, ip, headers); }
    catch (err) {
      if (!(err instanceof GameError)) console.error('Request failed:', err.name, err.message);
      return Response.json({ error: err instanceof GameError ? err.message : 'Server belum bisa menyimpan perubahan. Coba lagi sebentar.', code: err.code || 'server_error' }, { status: err.status || 500, headers });
    }
  };
}

// Deletes expired rooms and sessions. Run periodically.
export async function cleanup({ sessions, rooms }, deadline = Date.now() + 20000) {
  let removed = 0;
  for (const [store, fresh] of [[rooms, d => d.updatedAt > Date.now() - ROOM_AGE], [sessions, d => d.expires > Date.now()]]) {
    const { blobs } = await store.list();
    for (const { key } of blobs) {
      if (Date.now() > deadline) return removed;
      const entry = await store.getWithMetadata(key, { type: 'json' });
      if (entry?.data && !fresh(entry.data)) { await store.delete(key); removed++; }
    }
  }
  return removed;
}
