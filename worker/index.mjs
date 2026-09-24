import { DurableObject } from 'cloudflare:workers';
import { GameError, requireThat, validName, newRoom, membership, joinRoom, applyCommand, snapshot } from '../lib/game.mjs';

// Cloudflare Worker + Durable Objects backend.
// - Session DO (one per browser token): profile name/avatar and joined rooms.
// - Room DO (one per room code): authoritative game state in memory + SQLite
//   storage, pushed to players over hibernatable WebSockets.
// Auth is a random bearer token kept by the browser (no cookies), so the API
// can live on *.workers.dev while the page is served from another domain.

const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
const ROOM_AGE = 24 * 60 * 60 * 1000;
const RECEIPTS = 200;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const WS_PROTOCOL = 'abc';
const PUBLIC_LIST_LIMIT = 30;
// Feature flag, set as a Worker variable in the Cloudflare dashboard.
const publicRoomsEnabled = env => env.FEATURE_PUBLIC_ROOMS === 'true';

const hex = bytes => [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async text => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
const errorBody = err => ({ error: err.message, status: err.status, code: err.code });
// Durable Object RPC does not carry custom error fields, so DO methods return
// { error } objects and the Worker turns them back into GameErrors.
const attempt = async fn => { try { return await fn(); } catch (err) { if (err instanceof GameError) return { error: errorBody(err) }; throw err; } };
const unwrap = result => { if (result?.error) throw new GameError(result.error.error, result.error.status, result.error.code); return result; };
const publicProfile = p => ({ id: p.id, name: p.name, avatar: p.avatar, version: p.version });

export class Session extends DurableObject {
  async load() {
    const p = await this.ctx.storage.get('profile');
    return p && p.expires > Date.now() ? p : null;
  }
  async save(p) { await this.ctx.storage.put('profile', p); await this.ctx.storage.setAlarm(p.expires); }
  async create() {
    const p = { id: crypto.randomUUID(), name: '', avatar: 1, version: 1, rooms: [], expires: Date.now() + SESSION_AGE };
    await this.save(p); return p;
  }
  // Sliding expiry: an active browser keeps its name for 30 days after last use.
  async get() {
    const p = await this.load(); if (!p) return null;
    if (p.expires - Date.now() < SESSION_AGE - 24 * 60 * 60 * 1000) { p.expires = Date.now() + SESSION_AGE; await this.save(p); }
    return p;
  }
  async update(data) {
    return attempt(async () => {
      const p = await this.load(); requireThat(p, 'Sesi berakhir. Muat ulang dan isi nama kamu kembali.', 401, 'session_expired');
      const name = validName(data.name), avatar = data.avatar ?? p.avatar;
      requireThat(Number.isInteger(avatar) && avatar >= 1 && avatar <= 12, 'Pilih avatar yang tersedia.');
      requireThat(p.version === (data.version ?? -1), 'Nama sudah diperbarui di tab lain. Periksa nama terbaru, lalu simpan kembali.', 409, 'profile_conflict');
      p.name = name; p.avatar = avatar; p.version++;
      await this.save(p); return p;
    });
  }
  async rememberRoom(code) {
    const p = await this.load(); if (!p || p.rooms[0] === code) return;
    p.rooms = [code, ...p.rooms.filter(c => c !== code)].slice(0, 20); await this.save(p);
  }
  async alarm() { const p = await this.ctx.storage.get('profile'); if (!p || p.expires <= Date.now()) await this.ctx.storage.deleteAll(); }
}

// Directory of public rooms (single instance). Rooms push a small summary
// whenever they change; the landing page reads the list.
export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => { this.rooms = (await ctx.storage.get('rooms')) || {}; });
  }
  async upsert(entry) { this.rooms[entry.code] = entry; await this.ctx.storage.put('rooms', this.rooms); }
  async remove(code) { if (!this.rooms[code]) return; delete this.rooms[code]; await this.ctx.storage.put('rooms', this.rooms); }
  async list() {
    const cutoff = Date.now() - ROOM_AGE;
    return Object.values(this.rooms).filter(r => r.updatedAt > cutoff && r.online > 0)
      .sort((a, b) => (a.status === 'lobby' ? 0 : 1) - (b.status === 'lobby' ? 0 : 1) || b.updatedAt - a.updatedAt)
      .slice(0, PUBLIC_LIST_LIMIT);
  }
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.handoffMs = Number(env.HANDOFF_MS || 60000);
    this.commandTimes = new Map();
    // Keepalive pings are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => { this.room = (await ctx.storage.get('room')) || null; });
  }
  live() {
    requireThat(this.room && this.room.updatedAt > Date.now() - ROOM_AGE, 'Ruang tidak ditemukan atau sudah kedaluwarsa.', 404, 'room_missing');
    return this.room;
  }
  sockets(id, except) { return this.ctx.getWebSockets(id).filter(ws => ws !== except && ws.readyState === WebSocket.OPEN); }
  online(id, except) { return this.sockets(id, except).length > 0; }
  async save(closing) {
    await this.ctx.storage.put('room', this.room);
    const r = this.room;
    await this.ctx.storage.setAlarm(Math.min(r.handoffAt ?? Infinity, r.updatedAt + ROOM_AGE));
    // The public list is best-effort: it must never block or fail a game move.
    try { await this.publish(closing); } catch (err) { console.error('Public list update failed:', err); }
  }
  // Keep the public directory in sync: listed while public, open, not full and someone is online.
  async publish(closing) {
    const r = this.room, lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('public'));
    const active = r ? r.members.filter(m => m.active) : [];
    const online = active.filter(m => this.online(m.id, closing)).length;
    const listed = r && publicRoomsEnabled(this.env) && r.public && !r.locked && active.length < 12 && online > 0;
    if (listed) {
      const host = r.members.find(m => m.id === r.hostId);
      await lobby.upsert({ code: r.code, title: r.title, hostName: host?.name || '', hostAvatar: host?.avatar || 1, players: active.length, online,
        status: r.game?.status === 'playing' ? 'playing' : 'lobby', updatedAt: Date.now() });
      r.listed = true;
    } else if (r?.listed || (!r && this.code)) {
      await lobby.remove(r?.code || this.code);
      if (r) r.listed = false;
    }
  }
  context() { return { isOnline: id => this.online(id), publicRooms: publicRoomsEnabled(this.env) }; }
  syncMember(profile) {
    const m = this.room.members.find(x => x.id === profile.id);
    if (!m || (m.name === profile.name && m.avatar === profile.avatar)) return false;
    m.name = profile.name; m.avatar = profile.avatar; return true;
  }
  view(id, closing) {
    const r = this.room;
    return snapshot(r, id, mid => r.members.find(m => m.id === mid), mid => this.online(mid, closing));
  }
  // Every player gets their own role-filtered snapshot; removed players are disconnected.
  // skip: socket that already has fresh state; closing: socket to count as offline.
  broadcast({ skip, closing } = {}) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === skip || ws === closing || ws.readyState !== WebSocket.OPEN) continue;
      const { id } = ws.deserializeAttachment() || {};
      try { ws.send(JSON.stringify({ type: 'snapshot', room: this.view(id, closing) })); }
      catch (err) {
        if (!(err instanceof GameError)) throw err;
        ws.send(JSON.stringify({ type: 'removed', ...errorBody(err) })); ws.close(4403, 'removed');
      }
    }
  }

  async init(code, profile, title, isPublic = false) {
    if (this.room && this.room.updatedAt > Date.now() - ROOM_AGE) return { exists: true };
    const room = newRoom(code, profile.id, title);
    room.public = isPublic && publicRoomsEnabled(this.env);
    Object.assign(room.members[0], { name: profile.name, avatar: profile.avatar });
    room.receipts = []; room.handoffAt = null;
    this.room = room; await this.save(); return { code };
  }
  async join(profile) {
    return attempt(async () => {
      const room = this.live();
      joinRoom(room, profile.id); this.syncMember(profile);
      await this.save(); this.broadcast(); return { code: room.code };
    });
  }
  async syncProfile(profile) {
    if (!this.room || !this.syncMember(profile)) return;
    await this.save(); this.broadcast();
  }

  async fetch(request) {
    const member = JSON.parse(request.headers.get('X-Member'));
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [member.id]);
    server.serializeAttachment({ id: member.id });
    const response = new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': WS_PROTOCOL } });
    try {
      const room = this.live(); membership(room, member.id);
      this.syncMember(member);
      // The creator reclaims the host role whenever they reconnect.
      if (room.ownerId && member.id === room.ownerId && room.hostId !== member.id) { room.hostId = member.id; room.version++; }
      if (room.hostId === member.id) room.handoffAt = null;
      room.updatedAt = Date.now();
      await this.save();
      server.send(JSON.stringify({ type: 'snapshot', room: this.view(member.id) }));
      this.broadcast({ skip: server }); // others see this player come online
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      server.send(JSON.stringify({ type: 'removed', ...errorBody(err) })); server.close(4403, 'removed');
    }
    return response;
  }

  async webSocketMessage(ws, message) {
    let data;
    try { data = JSON.parse(message); } catch { return; }
    if (data?.type !== 'command') return;
    const { id } = ws.deserializeAttachment() || {};
    const reply = value => ws.send(JSON.stringify({ commandId: data.commandId, ...value }));
    try {
      const now = Date.now(), times = (this.commandTimes.get(id) || []).filter(t => t > now - 60000);
      times.push(now); this.commandTimes.set(id, times);
      requireThat(times.length <= 120, 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.', 429, 'rate_limit');
      requireThat(typeof data.commandId === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(data.commandId), 'Command ID tidak valid.');
      const room = this.live();
      const payload = await sha256(JSON.stringify(data));
      const old = room.receipts.find(r => r.id === data.commandId);
      if (old) {
        // Exact retry of a command that already ran: acknowledge without re-applying.
        requireThat(old.actor === id && old.payload === payload, 'Command ID sudah digunakan.', 409);
        return reply({ type: 'ack' });
      }
      requireThat(room.version === data.version, 'Ruang sudah berubah. Papan diperbarui; coba aksimu kembali.', 409, 'stale_state');
      const hostBefore = room.hostId;
      applyCommand(room, id, data.action, data, this.context());
      room.receipts = [{ id: data.commandId, actor: id, payload, at: now }, ...room.receipts].slice(0, RECEIPTS);
      if (room.hostId !== hostBefore) room.handoffAt = null;
      await this.save();
      reply({ type: 'ack' });
      this.broadcast();
    } catch (err) {
      if (!(err instanceof GameError)) { console.error('Command failed:', err); err = new GameError('Server belum bisa menyimpan perubahan. Coba lagi sebentar.', 500, 'server_error'); }
      reply({ type: 'error', ...errorBody(err) });
      if (err.code === 'stale_state' && this.room) try { ws.send(JSON.stringify({ type: 'snapshot', room: this.view(id) })); } catch {}
    }
  }

  async webSocketClose(ws) {
    if (!this.room) return;
    const { id } = ws.deserializeAttachment() || {};
    // Host left: give them a grace period, then an alarm hands the room over.
    if (id && id === this.room.hostId && !this.online(id, ws)) this.room.handoffAt = Date.now() + this.handoffMs;
    await this.save(ws);
    this.broadcast({ closing: ws });
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }

  async alarm() {
    const room = this.room; if (!room) return;
    const now = Date.now();
    if (room.handoffAt && room.handoffAt <= now) {
      room.handoffAt = null;
      if (!this.online(room.hostId)) {
        const successor = room.members.filter(m => m.active && this.online(m.id)).sort((a, b) => a.joinedAt - b.joinedAt)[0];
        if (successor) { room.hostId = successor.id; room.version++; }
      }
      await this.save(); this.broadcast();
      return;
    }
    if (room.updatedAt + ROOM_AGE <= now) {
      // Connected players keep the room alive; otherwise it expires.
      if (this.ctx.getWebSockets().length) { room.updatedAt = now; await this.save(); }
      else { this.code = room.code; this.room = null; await this.publish(); await this.ctx.storage.deleteAll(); }
      return;
    }
    await this.save();
  }
}

// ---- Worker: HTTP API, auth, CORS, and WebSocket routing ----
const limits = new Map();
function limited(key, max, windowMs = 60000) {
  const now = Date.now();
  if (limits.size > 5000) for (const [k, v] of limits) if (v.until < now) limits.delete(k);
  let s = limits.get(key);
  if (!s || s.until < now) { s = { n: 0, until: now + windowMs }; limits.set(key, s); }
  requireThat(++s.n <= max, 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.', 429, 'rate_limit');
}
function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return { ok: true, origin: null };
  if (origin === new URL(request.url).origin) return { ok: true, origin: null };
  // Entries may use one leading "*" wildcard, e.g. https://*--site.netlify.app for deploy previews.
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const matches = entry => entry === origin || (entry.includes('*') && new RegExp('^' + entry.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9-]+') + '$').test(origin));
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) && env.ALLOW_LOCALHOST === 'true';
  return { ok: list.some(matches) || local, origin };
}
function cors(headers, origin) {
  if (!origin) return headers;
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  return headers;
}
async function readJson(request) {
  const raw = await request.text();
  requireThat(raw.length <= 8192, 'Permintaan terlalu besar.', 413);
  try { const v = JSON.parse(raw || '{}'); requireThat(v && typeof v === 'object' && !Array.isArray(v), 'Format data tidak valid.'); return v; }
  catch (err) { if (err instanceof GameError) throw err; throw new GameError('Format JSON tidak valid.'); }
}
const sessionStub = (env, key) => env.SESSIONS.get(env.SESSIONS.idFromName(key));
const roomStub = (env, code) => env.ROOMS.get(env.ROOMS.idFromName(code));
async function authenticate(env, token) {
  const valid = typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
  const key = valid ? await sha256(token) : null;
  const profile = key && await sessionStub(env, key).get();
  requireThat(profile, 'Sesi berakhir. Muat ulang dan isi nama kamu kembali.', 401, 'session_expired');
  return { key, profile };
}
const bearer = request => (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

async function route(request, env, ip) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (path === '/health') return Response.json({ ok: true });
  limited(`ip:${ip}`, 2000);
  if (method === 'GET' && path === '/api/config') return Response.json({ publicRooms: publicRoomsEnabled(env) });
  if (method === 'GET' && path === '/api/rooms/public') {
    requireThat(publicRoomsEnabled(env), 'Daftar ruang publik sedang nonaktif.', 404, 'feature_disabled');
    limited(`list:${ip}`, 240);
    return Response.json({ rooms: await env.LOBBY.get(env.LOBBY.idFromName('public')).list() });
  }

  const ws = path.match(/^\/api\/rooms\/([A-Z2-9]{6})\/ws$/);
  if (ws && method === 'GET') {
    requireThat(request.headers.get('Upgrade') === 'websocket', 'Butuh koneksi WebSocket.', 426);
    const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(s => s.trim());
    requireThat(protocols[0] === WS_PROTOCOL, 'Protokol tidak dikenal.', 400);
    const { profile } = await authenticate(env, protocols[1]);
    const headers = new Headers(request.headers);
    headers.set('X-Member', JSON.stringify(publicProfile(profile)));
    return roomStub(env, ws[1]).fetch(new Request(request.url, { headers }));
  }

  if (method === 'GET' && path === '/api/me') {
    limited(`me:${ip}`, 600);
    const token = bearer(request);
    if (token) { try { const { profile } = await authenticate(env, token); return Response.json({ profile: publicProfile(profile) }); } catch (err) { if (err.code !== 'session_expired') throw err; } }
    limited(`session:${ip}`, 60);
    const fresh = randomHex(32);
    const profile = await sessionStub(env, await sha256(fresh)).create();
    return Response.json({ profile: publicProfile(profile), token: fresh });
  }

  const { key, profile: p } = await authenticate(env, bearer(request));
  if (method === 'PATCH' && path === '/api/me') {
    limited(`profile:${p.id}`, 30);
    const fresh = unwrap(await sessionStub(env, key).update(await readJson(request)));
    // Push the new name into every room this player belongs to.
    await Promise.all(fresh.rooms.map(code => roomStub(env, code).syncProfile(publicProfile(fresh)).catch(() => {})));
    return Response.json({ profile: publicProfile(fresh) });
  }
  if (method === 'POST' && path === '/api/rooms') {
    limited(`create:${p.id}`, 10);
    requireThat(p.name, 'Isi nama kamu terlebih dahulu.');
    const data = await readJson(request);
    const title = data.title ? validName(data.title) : 'Ruang rehat';
    for (let i = 0; i < 10; i++) {
      const code = [...crypto.getRandomValues(new Uint8Array(6))].map(n => ROOM_ALPHABET[n % ROOM_ALPHABET.length]).join('');
      const result = await roomStub(env, code).init(code, publicProfile(p), title, data.public === true);
      if (result.exists) continue;
      await sessionStub(env, key).rememberRoom(code);
      return Response.json({ code }, { status: 201 });
    }
    throw new GameError('Belum bisa membuat ruang. Coba lagi.', 500);
  }
  const join = path.match(/^\/api\/rooms\/([A-Z2-9]{6})\/join$/);
  if (join && method === 'POST') {
    limited(`join:${p.id}`, 30); requireThat(p.name, 'Isi nama kamu terlebih dahulu.');
    const result = unwrap(await roomStub(env, join[1]).join(publicProfile(p)));
    await sessionStub(env, key).rememberRoom(join[1]);
    return Response.json(result);
  }
  throw new GameError('Endpoint tidak ditemukan.', 404);
}

export default {
  async fetch(request, env) {
    const { ok, origin } = allowedOrigin(request, env);
    if (request.method === 'OPTIONS') {
      if (!ok) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors(new Headers({
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400'
      }), origin) });
    }
    let response;
    try {
      requireThat(ok, 'Permintaan harus dari aplikasi ini.', 403);
      response = await route(request, env, request.headers.get('CF-Connecting-IP') || 'local');
    } catch (err) {
      if (!(err instanceof GameError)) console.error('Request failed:', err);
      response = Response.json({ error: err instanceof GameError ? err.message : 'Server belum bisa menyimpan perubahan. Coba lagi sebentar.', code: err.code || 'server_error' }, { status: err.status || 500 });
    }
    if (response.status === 101) return response;
    const headers = cors(new Headers(response.headers), origin);
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  }
};
