import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createApp } from '../server.mjs';

test('120 connections across 10 rooms receive updates without secret payloads', { timeout: 30000 }, async t => {
  const app = createApp({ dbPath: ':memory:' });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const streams = [];
  const request = async (c, path, body, method = 'POST') => {
    const r = await fetch(base + '/api' + path, { method: body ? method : 'GET', headers: { Cookie: c.cookie || '', 'X-CSRF-Token': c.csrf || '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.headers.get('set-cookie')) c.cookie = r.headers.get('set-cookie').split(';')[0];
    const value = await r.json(); assert.ok(r.ok, JSON.stringify(value));
    if (value.csrf) c.csrf = value.csrf;
    return value;
  };
  try {
    const rooms = [];
    for (let r = 0; r < 10; r++) {
      const players = [];
      for (let p = 0; p < 12; p++) {
        const client = {};
        await request(client, '/me');
        await request(client, '/me', { name: `QA ${r}-${p}`, version: 1 }, 'PATCH');
        if (!p) client.code = (await request(client, '/rooms', { title: `Load ${r}` })).code;
        else { client.code = players[0].code; await request(client, `/rooms/${client.code}/join`, {}); }
        players.push(client);
      }
      rooms.push(players);
    }
    for (const players of rooms) {
      for (const c of players) {
        const controller = new AbortController();
        const response = await fetch(`${base}/api/rooms/${c.code}/events`, { headers: { Cookie: c.cookie }, signal: controller.signal });
        assert.equal(response.status, 200);
        const reader = response.body.getReader();
        const initial = new TextDecoder().decode((await reader.read()).value);
        assert.ok(initial.includes('event: update'));
        assert.ok(!initial.includes('cards'));
        streams.push({ reader, controller });
      }
    }
    assert.equal(streams.length, 120);
    const durations = [];
    for (const players of rooms) {
      const c = players[0];
      const state = await request(c, `/rooms/${c.code}`);
      const at = performance.now();
      await request(c, `/rooms/${c.code}/command`, { action: 'lock', version: state.version, commandId: crypto.randomUUID() });
      const snapshots = await Promise.all(players.map(p => request(p, `/rooms/${p.code}`)));
      snapshots.forEach(s => assert.equal(s.locked, true));
      durations.push(performance.now() - at);
    }
    // Verify the last subscriber sees notifications generated after connection.
    const bytes = await streams.at(-1).reader.read();
    assert.ok(new TextDecoder().decode(bytes.value).includes('event: update'));
    durations.sort((a,b) => a-b);
    t.diagnostic(`120 live SSE clients; local lock + 12 snapshot reads p95 ${durations.at(-1).toFixed(1)} ms. This is a local smoke test, not regional production latency.`);
  } finally {
    streams.forEach(s => s.controller.abort());
    await app.close();
  }
});
