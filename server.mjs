import http from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameError, requireThat, validName, newRoom, membership, joinRoom, applyCommand, snapshot } from './lib/game.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
const ROOM_AGE = 24 * 60 * 60 * 1000;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json' };

export function createApp({ dbPath = process.env.ABC_DB || resolve(root, 'data/abc.sqlite'), secure = process.env.COOKIE_SECURE === 'true' } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, csrf TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', avatar INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, actor TEXT NOT NULL, scope TEXT NOT NULL, payload TEXT NOT NULL, created INTEGER NOT NULL);
  `);
  const clients = new Map(), limits = new Map(), offlineSince = new Map();
  let stopped = false;
  const getProfile = id => db.prepare('SELECT id,name,avatar,version FROM profiles WHERE id=?').get(id);
  const getRoom = code => {
    const row = db.prepare('SELECT state,updated FROM rooms WHERE code=?').get(code);
    requireThat(row && row.updated > Date.now() - ROOM_AGE, 'Ruang tidak ditemukan atau sudah kedaluwarsa.', 404, 'room_missing');
    return JSON.parse(row.state);
  };
  const saveRoom = room => db.prepare('INSERT INTO rooms(code,state,updated) VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET state=excluded.state,updated=excluded.updated').run(room.code, JSON.stringify(room), room.updatedAt);
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (err) { db.exec('ROLLBACK'); throw err; } };
  const online = (code, id) => [...(clients.get(code) || [])].some(c => c.id === id);
  const notify = code => {
    for (const c of clients.get(code) || []) c.res.write(`event: update\ndata: {}\n\n`);
  };
  const limited = (key, max, windowMs = 60000) => {
    let state = limits.get(key);
    if (!state || state.until < Date.now()) { state = { n: 0, until: Date.now() + windowMs }; limits.set(key, state); }
    requireThat(++state.n <= max, 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.', 429, 'rate_limit');
  };
  function auth(req, res, create = false) {
    const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('abc_session='))?.slice(12);
    let profile = raw && db.prepare('SELECT * FROM profiles WHERE token_hash=? AND expires>?').get(hash(raw), Date.now());
    if (!profile && create) {
      const token = randomBytes(32).toString('hex');
      profile = { id: randomUUID(), token_hash: hash(token), csrf: randomBytes(24).toString('hex'), name: '', avatar: 1, version: 1, expires: Date.now() + SESSION_AGE };
      db.prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?)').run(profile.id, profile.token_hash, profile.csrf, profile.name, profile.avatar, profile.version, profile.expires);
      res.setHeader('Set-Cookie', `abc_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_AGE / 1000}${secure ? '; Secure' : ''}`);
    }
    requireThat(profile, 'Sesi berakhir. Muat ulang dan isi nama kamu kembali.', 401, 'session_expired');
    return profile;
  }
  function csrf(req, profile) {
    const origin = req.headers.origin;
    if (origin) {
      let host; try { host = new URL(origin).host; } catch { throw new GameError('Origin tidak valid.', 403); }
      requireThat(host === req.headers.host, 'Permintaan harus dari aplikasi ini.', 403);
    }
    requireThat(req.headers['sec-fetch-site'] !== 'cross-site', 'Permintaan lintas situs ditolak.', 403);
    const supplied = Buffer.from(String(req.headers['x-csrf-token'] || ''));
    const expected = Buffer.from(profile.csrf);
    requireThat(supplied.length === expected.length && timingSafeEqual(supplied, expected), 'Sesi tidak valid. Muat ulang halaman.', 403, 'csrf');
  }
  async function body(req) {
    let raw = '';
    for await (const chunk of req) { raw += chunk; requireThat(Buffer.byteLength(raw) <= 8192, 'Permintaan terlalu besar.', 413); }
    try { const value = JSON.parse(raw || '{}'); requireThat(value && typeof value === 'object' && !Array.isArray(value), 'Format data tidak valid.'); return value; }
    catch (err) { if (err instanceof GameError) throw err; throw new GameError('Format JSON tidak valid.'); }
  }
  const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const command = (profile, scope, data, fn) => transaction(() => {
    requireThat(typeof data.commandId === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(data.commandId), 'Command ID tidak valid.');
    const payload = JSON.stringify(data);
    const old = db.prepare('SELECT * FROM commands WHERE id=?').get(data.commandId);
    if (old) { requireThat(old.actor === profile.id && old.scope === scope && old.payload === payload, 'Command ID sudah digunakan.', 409); return; }
    fn();
    db.prepare('INSERT INTO commands VALUES(?,?,?,?,?)').run(data.commandId, profile.id, scope, payload, Date.now());
  });
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (path === '/health') return json(res, { ok: true });
      if (!path.startsWith('/api/')) {
        requireThat(req.method === 'GET' || req.method === 'HEAD', 'Metode tidak tersedia.', 405);
        const file = path === '/' || /^\/r\/[A-Z2-9]{6}$/.test(path) ? resolve(root, 'public/index.html') : resolve(root, 'public', '.' + decodeURIComponent(path));
        requireThat(file.startsWith(resolve(root, 'public') + '/') && existsSync(file) && statSync(file).isFile(), 'Halaman tidak ditemukan.', 404);
        res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'text/plain', 'Cache-Control': ['.html', '.js', '.css'].includes(extname(file)) ? 'no-cache' : 'public, max-age=3600' });
        return res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
      }
      limited(`ip:${req.socket.remoteAddress}`, 2000);
      if (req.method === 'GET' && path === '/api/me') {
        limited(`session:${req.socket.remoteAddress}`, 1500);
        const p = auth(req, res, true);
        return json(res, { profile: { id: p.id, name: p.name, avatar: p.avatar, version: p.version }, csrf: p.csrf });
      }
      const p = auth(req, res);
      if (!['GET', 'HEAD'].includes(req.method)) csrf(req, p);
      if (req.method === 'PATCH' && path === '/api/me') {
        limited(`profile:${p.id}`, 30);
        const data = await body(req);
        const name = validName(data.name), avatar = data.avatar ?? p.avatar;
        requireThat(Number.isInteger(avatar) && avatar >= 1 && avatar <= 12, 'Pilih avatar yang tersedia.');
        const changed = db.prepare('UPDATE profiles SET name=?,avatar=?,version=version+1 WHERE id=? AND version=?').run(name, avatar, p.id, data.version ?? -1);
        requireThat(changed.changes === 1, 'Nama sudah diperbarui di tab lain. Periksa nama terbaru, lalu simpan kembali.', 409, 'profile_conflict');
        for (const code of clients.keys()) notify(code);
        return json(res, { profile: getProfile(p.id) });
      }
      if (req.method === 'POST' && path === '/api/rooms') {
        limited(`create:${p.id}`, 10);
        requireThat(p.name, 'Isi nama kamu terlebih dahulu.');
        const data = await body(req);
        const title = data.title ? validName(data.title) : 'Ruang rehat';
        let code;
        do { code = [...randomBytes(6)].map(n => ROOM_ALPHABET[n % ROOM_ALPHABET.length]).join(''); } while (db.prepare('SELECT code FROM rooms WHERE code=?').get(code));
        saveRoom(newRoom(code, p.id, title));
        return json(res, { code }, 201);
      }
      const match = path.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|events|command))?$/);
      requireThat(match, 'Endpoint tidak ditemukan.', 404);
      const [, code, action] = match;
      if (req.method === 'POST' && action === 'join') {
        limited(`join:${p.id}`, 30); requireThat(p.name, 'Isi nama kamu terlebih dahulu.');
        transaction(() => { const room = getRoom(code); if (joinRoom(room, p.id)) saveRoom(room); });
        notify(code); return json(res, { code });
      }
      const room = getRoom(code); membership(room, p.id);
      if (req.method === 'GET' && !action) return json(res, snapshot(room, p.id, getProfile, id => online(code, id)));
      if (req.method === 'GET' && action === 'events') {
        requireThat(req.headers['sec-fetch-site'] !== 'cross-site', 'Akses ditolak.', 403);
        const set = clients.get(code) || new Set();
        requireThat([...set].filter(c => c.id === p.id).length < 8, 'Terlalu banyak tab ruang terbuka.', 429);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        const client = { id: p.id, res, expires: p.expires };
        set.add(client); clients.set(code, set); offlineSince.delete(`${code}:${p.id}`);
        res.write('retry: 2000\nevent: update\ndata: {}\n\n'); notify(code);
        req.on('close', () => { set.delete(client); if (!stopped) notify(code); });
        return;
      }
      if (req.method === 'POST' && action === 'command') {
        limited(`command:${p.id}`, 120);
        const data = await body(req);
        command(p, code, data, () => {
          const fresh = getRoom(code);
          requireThat(fresh.version === data.version, 'Ruang sudah berubah. Papan diperbarui; coba aksimu kembali.', 409, 'stale_state');
          applyCommand(fresh, p.id, data.action, data); saveRoom(fresh);
        });
        notify(code);
        for (const client of clients.get(code) || []) {
          if (!getRoom(code).members.some(m => m.id === client.id && m.active)) client.res.end();
        }
        return json(res, { ok: true });
      }
      throw new GameError('Metode tidak tersedia.', 405);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (!(err instanceof GameError)) console.error('Request failed:', err.name, err.message);
      json(res, { error: err instanceof GameError ? err.message : 'Server belum bisa menyimpan perubahan. Coba lagi sebentar.', code: err.code || 'server_error' }, err.status || 500);
    }
  });
  const heartbeat = setInterval(() => {
    try {
      for (const [code, set] of clients) {
        if (!set.size) { clients.delete(code); continue; }
        for (const c of set) { if (c.expires <= Date.now()) c.res.end(); else c.res.write(': heartbeat\n\n'); }
        const room = getRoom(code);
        // Active connections extend room retention; no gameplay version change.
        room.updatedAt = Date.now();
        if (room.hostId && !online(code, room.hostId)) {
          const key = `${code}:${room.hostId}`;
          if (!offlineSince.has(key)) offlineSince.set(key, Date.now());
          if (Date.now() - offlineSince.get(key) >= 60000) {
            const successor = room.members.filter(m => m.active && online(code, m.id)).sort((a, b) => a.joinedAt - b.joinedAt)[0];
            if (successor) { room.hostId = successor.id; room.version++; offlineSince.delete(key); notify(code); }
          }
        }
        saveRoom(room);
      }
      for (const [key, value] of limits) if (value.until < Date.now()) limits.delete(key);
      db.prepare('DELETE FROM commands WHERE created<?').run(Date.now() - ROOM_AGE);
      db.prepare('DELETE FROM rooms WHERE updated<?').run(Date.now() - ROOM_AGE);
      db.prepare('DELETE FROM profiles WHERE expires<?').run(Date.now());
    } catch (err) { console.error('Maintenance failed:', err.message); }
  }, 15000);
  heartbeat.unref();
  return { server, db, close: async () => {
    stopped = true; clearInterval(heartbeat);
    for (const set of clients.values()) for (const c of set) c.res.end();
    await new Promise(resolve => server.close(resolve)); db.close();
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.ABC_PORT || process.env.PORT || 3000), host = process.env.ABC_HOST || '127.0.0.1';
  app.server.listen(port, host, () => console.log(`ABC — Aku Butuh Code · http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
