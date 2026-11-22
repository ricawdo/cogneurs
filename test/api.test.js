/* Test de bout en bout : node test/api.test.js */
const assert = require('node:assert');
(async () => {
  const startPg = require('./pg.js'); const pg = await startPg();
  process.env.PORT = '3977';
  const server = require('../dev-server.js');
  const E = require('../public/engine.js');
  const base = 'http://localhost:3977';
  const client = (ip = '127.0.0.1') => { let ck = ''; return async (method, url, body, ct = 'application/json') => {
    const r = await fetch(base + url, { method, headers: { ...(body !== undefined ? { 'Content-Type': ct } : {}), Cookie: ck, 'x-real-ip': ip }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => null) }; }; };
  const a = client(), b = client(), anon = client();
  let r = await a('POST', '/api/register', { username: 'al', password: 'motdepasse1' }); assert.equal(r.status, 400);
  r = await a('POST', '/api/register', { username: 'alice', password: 'court' }); assert.equal(r.status, 400);
  r = await a('POST', '/api/register', { username: 'alice', password: 'motdepasse1' }); assert.equal(r.status, 201, JSON.stringify(r.data));
  r = await b('POST', '/api/register', { username: 'ALICE', password: 'motdepasse1' }); assert.equal(r.status, 409);
  r = await b('POST', '/api/register', { username: 'bob', password: 'motdepasse2' }); assert.equal(r.status, 201);
  r = await anon('GET', '/api/me'); assert.equal(r.status, 401);
  r = await anon('POST', '/api/login', { username: 'alice', password: 'faux' }); assert.equal(r.status, 401);
  r = await anon('POST', '/api/login', { username: 'Alice', password: 'motdepasse1' }); assert.equal(r.status, 200, 'connexion insensible à la casse');
  r = await anon('POST', '/api/login', { username: 'alice', password: 'motdepasse1' }, 'text/plain'); assert.equal(r.status, 415);
  r = await a('POST', '/api/brute', { name: '<script>' }); assert.equal(r.status, 400);
  r = await a('POST', '/api/brute', { name: 'Bastoche' }); assert.equal(r.status, 201, JSON.stringify(r.data));
  r = await b('POST', '/api/brute', { name: 'bastoche' }); assert.equal(r.status, 409);
  r = await b('POST', '/api/brute', { name: 'Ginette' }); assert.equal(r.status, 201);
  r = await a('GET', '/api/me'); assert.equal(r.data.fightsLeft, 6); assert.equal(r.data.opps.length, 3);
  let sawPlayer = false;
  for (let i = 0; i < 6; i++) {
    r = await a('GET', '/api/me'); if (r.data.pending) await a('POST', '/api/levelup', { choice: 0 });
    r = await a('GET', '/api/me'); if (r.data.opps.some(o => !o.bot)) sawPlayer = true;
    r = await a('POST', '/api/fight', { kind: 'ar', idx: 0 }); assert.equal(r.status, 200, JSON.stringify(r.data));
    const { win } = E.simulate(r.data.A, r.data.B, E.RNG(r.data.seed)); assert.equal(win === 0, r.data.won, 'rejeu déterministe');
  }
  r = await a('GET', '/api/me'); if (r.data.pending) await a('POST', '/api/levelup', { choice: 1 });
  r = await a('POST', '/api/fight', { kind: 'ar', idx: 0 }); assert.equal(r.status, 429, 'limite quotidienne');
  r = await a('GET', '/api/me');
  if (r.data.event) {
    assert.deepEqual(r.data.event.scores, { manif: 0, police: 0 });
    r = await a('POST', '/api/fight', { kind: 'ev', idx: 0 }); assert.equal(r.status, 400);
    r = await a('POST', '/api/camp', { camp: 'police' }); assert.equal(r.status, 200);
    r = await a('POST', '/api/camp', { camp: 'manif' }); assert.equal(r.status, 409);
    await b('GET', '/api/me'); r = await b('POST', '/api/camp', { camp: 'manif' }); assert.equal(r.status, 200);
    let wins = 0;
    for (let i = 0; i < 4; i++) { r = await a('POST', '/api/fight', { kind: 'ev', idx: 0 }); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.mult, 2); wins += r.data.won; if (r.data.leveled) await a('POST', '/api/levelup', { choice: 0 }); }
    r = await a('GET', '/api/me'); assert.equal(r.data.event.scores.police, wins, 'score du camp');
    assert.deepEqual(r.data.event.players, { manif: 1, police: 1 });
  }
  r = await a('GET', '/api/replay?id=1'); assert.equal(r.status, 200);
  r = await b('GET', '/api/me'); const defs = r.data.hist.filter(h => !h.mine).length;
  r = await a('GET', '/api/top'); assert.ok(r.data.length >= 2);
  // Concurrence : 6 combats lancés en même temps ne doivent pas dépasser la limite
  const c = client('10.0.0.9'); r = await c('POST', '/api/register', { username: 'zed', password: 'x' }); await c('POST', '/api/register', { username: 'carla', password: 'motdepasse3' }); await c('POST', '/api/brute', { name: 'Carla' });
  const par = await Promise.all(Array.from({ length: 9 }, () => c('POST', '/api/fight', { kind: 'ar', idx: 0 })));
  const okCount = par.filter(x => x.status === 200).length;  assert.ok(okCount <= 6, 'pas plus de 6 combats même en parallèle : ' + okCount);
  r = await a('POST', '/api/logout', {}); r = await a('GET', '/api/me'); assert.equal(r.status, 401);
  console.log(`OK — rejeu identique, adversaire joueur vu : ${sawPlayer}, défenses de Bob : ${defs}, combats parallèles acceptés : ${okCount}`);
  server.close(); await require('../lib/app.js').close(); await pg.stop(); process.exit(0);
})().catch(e => { console.error('ÉCHEC', e); process.exit(1); });
