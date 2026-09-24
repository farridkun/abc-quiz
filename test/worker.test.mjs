import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Integration test against the real Worker running in workerd via `wrangler dev`.
const PORT = 8790 + Math.floor(Math.random() * 100);
const base = `http://127.0.0.1:${PORT}`;
const persist = mkdtempSync(join(tmpdir(), 'abc-worker-'));

function startWorker() {
  const child = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(PORT), '--persist-to', persist,
    '--var', 'HANDOFF_MS:1500', '--var', 'ALLOW_LOCALHOST:true', '--show-interactive-dev-session=false'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, detached: true });
  let log = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('wrangler dev did not start:\n' + log)); }, 90000);
    const onData = chunk => { log += chunk; if (/Ready on/.test(log)) { clearTimeout(timer); resolve(child); } };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`wrangler exited ${code}:\n${log}`)); });
  });
}
// wrangler spawns the runtime as a child; signal the whole process group so nothing is left running.
const stop = child => new Promise(r => {
  child.removeAllListeners('exit');
  if (child.exitCode !== null) return r();
  child.on('exit', r);
  try { process.kill(-child.pid, 'SIGINT'); } catch {}
  setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} r(); }, 5000).unref();
});

function client() {
  const c = {
    token: '', profile: null, ws: null, snaps: [], waiters: [], replies: new Map(),
    async call(path, data, method = 'POST', expect = 200) {
      const res = await fetch(base + '/api' + path, { method: data === undefined ? 'GET' : method, headers: { ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}), 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      const result = await res.json(); assert.equal(res.status, expect, `${path}: ${JSON.stringify(result)}`);
      if (result.token) c.token = result.token; if (result.profile) c.profile = result.profile; return result;
    },
    connect(code) {
      c.snaps = []; c.closed = null;
      c.ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/rooms/${code}/ws`, ['abc', c.token]);
      c.ws.onmessage = e => {
        if (e.data === 'pong') return;
        const m = JSON.parse(e.data);
        if (m.type === 'snapshot') { c.snaps.push(m.room); c.waiters.splice(0).forEach(w => w()); }
        else if (m.commandId) c.replies.get(m.commandId)?.(m);
        else if (m.type === 'removed') c.removed = m;
      };
      c.ws.onclose = e => { c.closed = e.code; c.waiters.splice(0).forEach(w => w()); };
      return c.next();
    },
    // Resolves with the next snapshot matching fn (or the latest one if already matching).
    next(fn = () => true, ms = 5000) {
      return new Promise((resolve, reject) => {
        const check = () => { const s = c.snaps.at(-1); if (s && fn(s)) { resolve(s); return true; } if (c.closed) { reject(new Error('closed ' + c.closed)); return true; } return false; };
        if (check()) return;
        const timer = setTimeout(() => reject(new Error('timeout waiting for snapshot; last: ' + JSON.stringify(c.snaps.at(-1) && { v: c.snaps.at(-1).version, members: c.snaps.at(-1).members.map(m => [m.name, m.team, m.role, m.online]), host: c.snaps.at(-1).hostId, game: !!c.snaps.at(-1).game }) + ' count ' + c.snaps.length)), ms);
        const wait = () => { if (check()) clearTimeout(timer); else c.waiters.push(wait); };
        c.waiters.push(wait);
      });
    },
    send(payload) {
      return new Promise(resolve => { c.replies.set(payload.commandId, resolve); c.ws.send(JSON.stringify({ type: 'command', ...payload })); });
    },
    command(action, extra = {}) { return c.send({ action, ...extra, version: c.snaps.at(-1).version, commandId: randomUUID() }); },
    get room() { return c.snaps.at(-1); },
    close() { c.ws?.close(); }
  };
  return c;
}

test('Cloudflare Worker: realtime multiplayer, secrets, idempotency, persistence, host handoff', { timeout: 180000 }, async () => {
  let worker = await startWorker();
  const clients = [];
  const make = async name => { const c = client(); clients.push(c); await c.call('/me'); if (name) await c.call('/me', { name, version: 1 }, 'PATCH'); return c; };
  try {
    assert.deepEqual(await (await fetch(base + '/health')).json(), { ok: true });
    // Foreign origins are rejected; the configured one gets CORS headers.
    assert.equal((await fetch(base + '/api/me', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const pre = await fetch(base + '/api/me', { method: 'OPTIONS', headers: { Origin: 'https://abc-quiz.farrid.dev', 'Access-Control-Request-Method': 'PATCH' } });
    assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://abc-quiz.farrid.dev');

    const host = await make(); assert.equal(host.profile.name, '');
    await host.call('/rooms', {}, 'POST', 400);
    await host.call('/me', { name: '  Rani  ', version: 1 }, 'PATCH'); assert.equal(host.profile.name, 'Rani');
    const stableId = host.profile.id;
    await host.call('/me'); assert.equal(host.profile.id, stableId); // token keeps identity
    const { code } = await host.call('/rooms', { title: 'Jeda kantor' }, 'POST', 201);
    const players = [host];
    for (const name of ['Bima', 'Naya', 'Dito', 'Rani']) { const c = await make(name); await c.call(`/rooms/${code}/join`, {}); players.push(c); }
    for (const c of players) await c.connect(code);
    await host.next(s => s.members.length === 5 && s.members.every(m => m.online));

    const outsider = await make('Luar');
    await assert.rejects(outsider.connect(code)); assert.equal(outsider.removed?.code, 'not_member');

    // Seat everyone; each change is pushed to all players.
    for (const [i, team, role] of [[0, 'coral', 'spymaster'], [1, 'coral', 'guesser'], [2, 'ocean', 'spymaster'], [3, 'ocean', 'guesser']]) {
      await players[i].next(s => s.version === host.room.version);
      assert.equal((await players[i].command('seat', { team, role })).type, 'ack');
      await host.next(s => s.members.find(m => m.id === players[i].profile.id).role === role && s.members.find(m => m.id === players[i].profile.id).team === team);
    }
    assert.equal((await host.command('start')).type, 'ack');
    const spy = await host.next(s => s.game);
    assert.ok(spy.game.cards.every(c => c.type));
    for (const i of [1, 3, 4]) { const snap = await players[i].next(s => s.game); assert.ok(snap.game.cards.every(c => !('type' in c))); assert.ok(!JSON.stringify(snap).includes('"banned"')); assert.ok(!JSON.stringify(snap).includes('receipts')); }

    // Renames are pushed without changing the game version.
    const version = host.room.version;
    await host.call('/me', { name: 'Rani Putri', avatar: 4, version: host.profile.version }, 'PATCH');
    const renamed = await players[1].next(s => s.members.find(m => m.id === stableId).name === 'Rani Putri');
    assert.equal(renamed.version, version);
    await host.call('/me', { name: 'Nama lama', version: 1 }, 'PATCH', 409);
    await host.call('/me', { name: ' ', version: host.profile.version }, 'PATCH', 400);
    assert.equal((await fetch(base + '/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);

    const team = spy.game.team, giver = team === 'coral' ? host : players[2], guesser = team === 'coral' ? players[1] : players[3];
    await giver.next(s => s.version === host.room.version);
    assert.equal((await giver.command('clue', { word: 'Asosiasi', count: 2 })).type, 'ack');
    const ready = await guesser.next(s => s.game.phase === 'guess');
    const own = spy.game.cards.map((c, i) => c.type === team ? i : -1).filter(i => i >= 0);
    const payload = { action: 'guess', index: own[0], version: ready.version, commandId: randomUUID() };
    assert.equal((await guesser.send(payload)).type, 'ack');
    assert.equal((await guesser.send(payload)).type, 'ack'); // exact retry: no second reveal
    const once = await guesser.next(s => s.game.guesses === 1);
    assert.equal(once.game.cards.filter(c => c.revealed).length, 1);
    const stale = await guesser.send({ ...payload, commandId: randomUUID(), index: own[1] });
    assert.equal(stale.code, 'stale_state');
    // Two guesses racing on the same version: exactly one wins.
    const raced = await Promise.all([own[1], own[2]].map(index => guesser.send({ action: 'guess', index, version: once.version, commandId: randomUUID() })));
    assert.deepEqual(raced.map(r => r.type).sort(), ['ack', 'error']);
    await host.next(s => s.game.guesses === 2);

    // Restart the runtime with the same storage: game and names survive.
    clients.forEach(c => c.close());
    await stop(worker); worker = await startWorker();
    await host.call('/me'); assert.equal(host.profile.name, 'Rani Putri'); assert.equal(host.profile.avatar, 4); assert.equal(host.profile.id, stableId);
    const restored = await guesser.connect(code);
    assert.equal(restored.game.guesses, 2); assert.equal(restored.game.cards.filter(c => c.revealed).length, 2);
    await host.connect(code);
    assert.equal((await host.command('abort')).type, 'ack');
    await host.next(s => s.game?.status === 'finished');
    assert.equal((await host.command('rematch')).type, 'ack');
    const next = await host.call('/rooms', { title: 'Room kedua' }, 'POST', 201);
    const other = client(); other.token = host.token; assert.equal((await other.connect(next.code)).members[0].name, 'Rani Putri'); other.close();

    // Kick closes the target's socket and blocks rejoining.
    const target = players[4]; await target.connect(code);
    await host.next(s => s.members.find(m => m.id === target.profile.id)?.online);
    assert.equal((await host.command('kick', { memberId: target.profile.id })).type, 'ack');
    for (let i = 0; i < 50 && target.ws.readyState < WebSocket.CLOSING; i++) await new Promise(r => setTimeout(r, 100));
    // Server sent a close frame (CLOSING/CLOSED on the client side).
    assert.equal(target.removed?.code, 'not_member'); assert.ok(target.ws.readyState >= WebSocket.CLOSING);
    await target.call(`/rooms/${code}/join`, {}, 'POST', 403);

    // Host disconnects: after the grace period an online player becomes host.
    await guesser.next(s => s.hostId === stableId);
    host.close();
    const handed = await guesser.next(s => s.hostId !== stableId, 10000);
    assert.equal(handed.hostId, guesser.profile.id);
    assert.equal(handed.members.find(m => m.id === stableId).online, false);
  } catch (err) {
    console.error('FAILED:', err); throw err;
  } finally {
    clients.forEach(c => c.close());
    await stop(worker);
    rmSync(persist, { recursive: true, force: true });
  }
});
