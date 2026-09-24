import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createHandler, ONLINE_WINDOW } from '../lib/app.mjs';
import { MemoryStore } from '../lib/memory-store.mjs';
import { createApp } from '../server.mjs';

test('120 polling clients across 10 rooms see updates and presence without secret payloads', { timeout: 30000 }, async t => {
  const app = createApp();
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
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
    const durations = [];
    for (const players of rooms) {
      const c = players[0];
      const state = await request(c, `/rooms/${c.code}`);
      assert.equal(state.members.length, 12);
      assert.ok(state.members.every(m => m.online && !('seenAt' in m)));
      const at = performance.now();
      await request(c, `/rooms/${c.code}/command`, { action: 'lock', version: state.version, commandId: crypto.randomUUID() });
      // Every player polling at once also refreshes presence concurrently.
      const snapshots = await Promise.all(players.map(p => request(p, `/rooms/${p.code}`)));
      snapshots.forEach(s => { assert.equal(s.locked, true); assert.ok(!JSON.stringify(s).includes('receipts')); });
      durations.push(performance.now() - at);
    }
    durations.sort((a, b) => a - b);
    t.diagnostic(`local lock + 12 concurrent polls p95 ${durations.at(-1).toFixed(1)} ms. Local smoke test, not production latency.`);
  } finally { await app.close(); }
});

test('host hands off to an online member after being away, and presence expires', async () => {
  const stores = { sessions: new MemoryStore(), rooms: new MemoryStore() };
  const handle = createHandler(stores);
  const clients = [];
  const call = async (c, path, body, method = 'POST') => {
    const r = await handle(new Request('http://abc.test/api' + path, { method: body ? method : 'GET', headers: { Cookie: c.cookie || '', 'X-CSRF-Token': c.csrf || '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }));
    const cookie = r.headers.getSetCookie()[0]; if (cookie) c.cookie = cookie.split(';')[0];
    const value = await r.json(); assert.ok(r.ok, JSON.stringify(value)); if (value.csrf) c.csrf = value.csrf; return value;
  };
  for (const name of ['Host', 'Tamu', 'Diam']) { const c = {}; await call(c, '/me'); c.profile = (await call(c, '/me', { name, version: 1 }, 'PATCH')).profile; clients.push(c); }
  const [host, guest, idle] = clients;
  const { code } = await call(host, '/rooms', {});
  await call(idle, `/rooms/${code}/join`, {});
  await call(guest, `/rooms/${code}/join`, {});
  // Age everyone except the guest as if they stopped polling 2 minutes ago.
  const entry = await stores.rooms.getWithMetadata(code);
  for (const m of entry.data.members) if (m.id !== guest.profile.id) m.seenAt = Date.now() - 120000;
  await stores.rooms.setJSON(code, entry.data);
  const snap = await call(guest, `/rooms/${code}`);
  assert.equal(snap.hostId, guest.profile.id);
  assert.equal(snap.members.find(m => m.id === idle.profile.id).online, false);
  assert.equal(snap.members.find(m => m.id === guest.profile.id).online, true);
  assert.ok(ONLINE_WINDOW < 60000);
});
