import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server.mjs';

test('API multiplayer, secret isolation, concurrency, persistence and manual names', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'abc-test-'));
  const dbPath = join(dir, 'test.sqlite');
  let app = createApp({ dbPath }); let base;
  async function start() { await new Promise(r => app.server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${app.server.address().port}`; }
  await start();
  const clients = [];
  function client() {
    const c = { cookie: '', csrf: '', profile: null, async call(path, data, method = 'POST', expect = 200) {
      const res = await fetch(base + '/api' + path, { method: data === undefined ? 'GET' : method, headers: { Cookie: this.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf, Origin: base }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      if (res.headers.get('set-cookie')) this.cookie = res.headers.get('set-cookie').split(';')[0];
      const result = await res.json(); assert.equal(res.status, expect, JSON.stringify(result));
      if (result.csrf) this.csrf = result.csrf; if (result.profile) this.profile = result.profile; return result;
    }}; clients.push(c); return c;
  }
  try {
    const host = client(); await host.call('/me'); assert.equal(host.profile.name, '');
    await host.call('/rooms', {}, 'POST', 400);
    await host.call('/me', { name: '  Rani  ', version: 1 }, 'PATCH'); assert.equal(host.profile.name, 'Rani');
    const stableId = host.profile.id;
    const { code } = await host.call('/rooms', { title: 'Jeda kantor' }, 'POST', 201);
    const players = [host];
    for (const name of ['Bima', 'Naya', 'Dito', 'Rani']) { const c = client(); await c.call('/me'); await c.call('/me', { name, version: 1 }, 'PATCH'); await c.call(`/rooms/${code}/join`, {}); players.push(c); }
    const outsider = client(); await outsider.call('/me'); await outsider.call(`/rooms/${code}`, undefined, 'GET', 403);
    let current = await host.call(`/rooms/${code}`);
    async function command(c, action, extra = {}) { current = await host.call(`/rooms/${code}`); return c.call(`/rooms/${code}/command`, { action, ...extra, version: current.version, commandId: randomUUID() }); }
    for (const [i, team, role] of [[0, 'coral', 'spymaster'], [1, 'coral', 'guesser'], [2, 'ocean', 'spymaster'], [3, 'ocean', 'guesser']]) await command(players[i], 'seat', { team, role });
    await command(host, 'start');
    const spy = await host.call(`/rooms/${code}`); assert.ok(spy.game.cards.every(c => c.type));
    for (const i of [1, 3, 4]) { const snap = await players[i].call(`/rooms/${code}`); assert.ok(snap.game.cards.every(c => !('type' in c))); assert.ok(!JSON.stringify(snap).includes('"banned"')); }
    // Name changes do not mutate gameplay version/identity/role and are seen by others.
    const oldVersion = host.profile.version;
    await host.call('/me', { name: 'Rani Putri', avatar: 4, version: oldVersion }, 'PATCH');
    await host.call('/me'); assert.equal(host.profile.name, 'Rani Putri'); assert.equal(host.profile.id, stableId);
    const renamed = await players[1].call(`/rooms/${code}`); assert.equal(renamed.members.find(m => m.id === stableId).name, 'Rani Putri'); assert.equal(renamed.version, spy.version);
    await host.call('/me', { name: 'Nama lama', version: oldVersion }, 'PATCH', 409);
    await host.call('/me', { name: ' ', version: host.profile.version }, 'PATCH', 400);
    const stolen = await fetch(base + '/api/me', { method: 'PATCH', headers: { Cookie: host.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Penyusup', version: host.profile.version }) }); assert.equal(stolen.status, 403);
    const team = spy.game.team, giver = team === 'coral' ? host : players[2], guesser = team === 'coral' ? players[1] : players[3];
    await command(giver, 'clue', { word: 'Asosiasi', count: 2 });
    const fresh = await guesser.call(`/rooms/${code}`);
    const known = await giver.call(`/rooms/${code}`);
    const own = known.game.cards.map((c, i) => c.type === team ? i : -1).filter(i => i >= 0);
    const payload = { action: 'guess', index: own[0], version: fresh.version, commandId: randomUUID() };
    await guesser.call(`/rooms/${code}/command`, payload);
    await guesser.call(`/rooms/${code}/command`, payload); // exact retry succeeds without second reveal
    const once = await guesser.call(`/rooms/${code}`); assert.equal(once.game.guesses, 1);
    await guesser.call(`/rooms/${code}/command`, { ...payload, commandId: randomUUID(), index: own[1] }, 'POST', 409);
    assert.equal((await guesser.call(`/rooms/${code}`)).game.guesses, 1);
    const raced = await Promise.all([own[1], own[2]].map(index => fetch(`${base}/api/rooms/${code}/command`, {
      method: 'POST', headers: { Cookie: guesser.cookie, 'X-CSRF-Token': guesser.csrf, 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ action: 'guess', index, version: once.version, commandId: randomUUID() })
    })));
    assert.deepEqual(raced.map(r => r.status).sort(), [200, 409]);
    await Promise.all(raced.map(r => r.json()));
    assert.equal((await guesser.call(`/rooms/${code}`)).game.guesses, 2);
    // Reconnect/restart retains the full game and exact user-selected display name.
    await app.close(); app = createApp({ dbPath }); await start();
    await host.call('/me'); assert.equal(host.profile.name, 'Rani Putri'); assert.equal(host.profile.avatar, 4); assert.equal(host.profile.id, stableId);
    const restored = await guesser.call(`/rooms/${code}`); assert.equal(restored.game.guesses, 2); assert.equal(restored.game.cards.filter(c => c.revealed).length, 2);
    await command(host, 'abort'); await command(host, 'rematch'); await host.call('/me'); assert.equal(host.profile.name, 'Rani Putri');
    const next = await host.call('/rooms', { title: 'Room kedua' }, 'POST', 201);
    assert.equal((await host.call(`/rooms/${next.code}`)).members[0].name, 'Rani Putri');
    await command(host, 'kick', { memberId: players[4].profile.id }); await players[4].call(`/rooms/${code}/join`, {}, 'POST', 403);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
