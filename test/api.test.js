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
  r = await anon('GET', '/api/index?__route=me'); assert.equal(r.status, 401, 'routage Vercel réécrit');
  r = await anon('GET', '/api/index?__route=top'); assert.equal(r.status, 200, 'routage Vercel vers top');
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
  r = await a('GET', '/api/index?__route=replay&id=1'); assert.equal(r.status, 200, 'routage avec paramètre');
  r = await b('GET', '/api/me'); const defs = r.data.hist.filter(h => !h.mine).length;
  r = await a('GET', '/api/top'); assert.ok(r.data.brutes.length >= 2);
  // Concurrence : 6 combats lancés en même temps ne doivent pas dépasser la limite
  const c = client('10.0.0.9'); r = await c('POST', '/api/register', { username: 'zed', password: 'x' }); await c('POST', '/api/register', { username: 'carla', password: 'motdepasse3' }); await c('POST', '/api/brute', { name: 'Carla' });
  const par = await Promise.all(Array.from({ length: 9 }, () => c('POST', '/api/fight', { kind: 'ar', idx: 0 })));
  const okCount = par.filter(x => x.status === 200).length;  assert.ok(okCount <= 6, 'pas plus de 6 combats même en parallèle : ' + okCount);
  // Élèves
  const d = client('10.0.0.7');
  await d('POST', '/api/register', { username: 'dora', password: 'motdepasse4' });
  r = await d('POST', '/api/brute', { name: 'Dora', master: 'Inconnu' }); assert.equal(r.status, 404, 'maître inexistant');
  r = await d('POST', '/api/brute', { name: 'Dora', master: 'bastoche' }); assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.fightsLeft, 8, 'combats bonus élève'); assert.equal(r.data.master.name, 'Bastoche'); assert.ok(r.data.news && r.data.news[0].includes('Bienvenue'));
  r = await a('GET', '/api/me'); assert.equal(r.data.pupils.length, 1); assert.ok(r.data.news.some(n => n.includes('Nouvel élève')));
  const xpBefore = r.data.xp, lvlBefore = r.data.brute.level;
  await pg.pg.query("update brutes set data = jsonb_set(data, '{xp}', '9') where name = 'Dora'");
  r = await d('GET', '/api/me'); assert.equal(r.data.brute.level, 2); await d('POST', '/api/levelup', { choice: 0 });
  r = await d('GET', '/api/me'); assert.equal(r.data.brute.level, 3, 'élève niveau 3');
  r = await a('GET', '/api/me'); assert.ok(r.data.news.some(n => n.includes('niveau 3 : +3 XP')), JSON.stringify(r.data.news));
  assert.ok(r.data.brute.level > lvlBefore || r.data.xp === xpBefore + 3, 'XP du maître');
  r = await a('GET', '/api/top'); assert.equal(r.data.masters[0].name, 'Bastoche'); assert.equal(r.data.masters[0].pupils, 1);
  // Pas deux fois le même adversaire par jour, et XP de défense
  const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  const f = client('10.0.0.11'), g = client('10.0.0.12'), h = client('10.0.0.13');
  await f('POST', '/api/register', { username: 'fred', password: 'motdepasse5' }); await f('POST', '/api/brute', { name: 'Fred' });
  await pg.pg.query(`update brutes set level = 1, data = jsonb_set(jsonb_set(data, '{stats}', '{"force":60,"agilite":60,"rapidite":60,"endurance":60}'), '{level}', '1') where name = 'Fred'`);
  await g('POST', '/api/register', { username: 'gaby', password: 'motdepasse6' }); await g('POST', '/api/brute', { name: 'Gaby' });
  const seen = new Set(); let metFred = 0;
  for (let i = 0; i < 6; i++) {
    r = await g('GET', '/api/me'); if (r.data.pending) await g('POST', '/api/levelup', { choice: 0 });
    r = await g('GET', '/api/me'); const idx = r.data.opps.findIndex(o => o.name === 'Fred'); const k = idx < 0 ? 0 : idx;
    r = await g('POST', '/api/fight', { kind: 'ar', idx: k }); assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(!seen.has(r.data.B.name), 'adversaire déjà affronté : ' + r.data.B.name); seen.add(r.data.B.name);
    if (r.data.B.name === 'Fred') { metFred++; assert.equal(r.data.won, false, 'Fred surpuissant gagne'); }
  }
  assert.equal(metFred, 1, 'Fred affronté exactement une fois');
  r = await b('GET', '/api/me'); assert.ok(r.data.hist.filter(x => !x.mine).every(x => x.xp === 1) || r.data.defXpToday === 3, 'défense perdue ou gagnée : +1 XP');
  r = await f('GET', '/api/me'); assert.equal(r.data.xp, 1, 'XP de défense'); assert.equal(r.data.defXpToday, 1);
  assert.ok(r.data.hist.some(x => !x.mine && x.won && x.xp === 1), 'défense gagnée visible avec +1 XP');
  await pg.pg.query(`update brutes set state = jsonb_set(jsonb_set(state, '{defDay}', '"${today}"'), '{defXp}', '3') where name = 'Fred'`);
  await h('POST', '/api/register', { username: 'hugo', password: 'motdepasse7' }); await h('POST', '/api/brute', { name: 'Hugo' });
  await h('GET', '/api/me');
  await pg.pg.query(`update brutes set state = jsonb_set(state, '{opps}', jsonb_build_array(jsonb_build_object('t', 'p', 'id', (select id from brutes where name = 'Fred')), '{"t":"b","name":"Bidule","level":1}'::jsonb, '{"t":"b","name":"Truc","level":1}'::jsonb)) where name = 'Hugo'`);
  r = await h('GET', '/api/me'); const fi = r.data.opps.findIndex(o => o.name === 'Fred'); assert.ok(fi >= 0, 'Fred proposé à Hugo');
  r = await h('POST', '/api/fight', { kind: 'ar', idx: fi }); assert.equal(r.data.won, false);
  r = await f('GET', '/api/me'); assert.equal(r.data.xp, 1, 'plafond de défense respecté');
  // Notifications
  r = await a('GET', '/api/push-key'); assert.ok(r.data.key && r.data.key.length > 80, 'clé publique VAPID');
  const r2 = await a('GET', '/api/push-key'); assert.equal(r2.data.key, r.data.key, 'clé stable');
  r = await a('POST', '/api/push', { subscription: { endpoint: 'http://pas-https', keys: { p256dh: 'x', auth: 'y' } } }); assert.equal(r.status, 400);
  const got = [];
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-'));
  require('node:child_process').execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 1 -subj /CN=localhost 2>/dev/null`);
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const mock = require('node:https').createServer({ key: fs.readFileSync(dir + '/k.pem'), cert: fs.readFileSync(dir + '/c.pem') }, (q, s) => { got.push(q.url); s.writeHead(q.url.includes('gone') ? 410 : 201); s.end(); }).listen(3978);
  const wp = require('web-push'), k = wp.generateVAPIDKeys();
  const crypto = require('node:crypto'), ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const p256dh = ecdh.getPublicKey().toString('base64url'), auth = crypto.randomBytes(16).toString('base64url');
  r = await a('POST', '/api/push', { subscription: { endpoint: 'https://push.example.com/abc', keys: { p256dh, auth } } }); assert.equal(r.status, 200);
  await pg.pg.query(`update push_subs set endpoint = 'https://localhost:3978/ok', sub = jsonb_set(sub, '{endpoint}', '"https://localhost:3978/ok"')`);
  await pg.pg.query(`update push_subs set user_id = (select id from users where username = 'dora')`);
  await pg.pg.query(`insert into push_subs (user_id, endpoint, sub, created) select id, 'https://localhost:3978/alice', jsonb_build_object('endpoint','https://localhost:3978/alice','keys',jsonb_build_object('p256dh','${p256dh}','auth','${auth}')), 0 from users where username = 'alice'`);
  await pg.pg.query(`insert into push_subs (user_id, endpoint, sub, created) select id, 'https://localhost:3978/gone', jsonb_build_object('endpoint','https://localhost:3978/gone','keys',jsonb_build_object('p256dh','${p256dh}','auth','${auth}')), 0 from users where username = 'bob'`);
  process.env.CRON_SECRET = 'test-secret';
  
  const cr = await fetch(base + '/api/cron-notify', { headers: { Authorization: 'Bearer test-secret' } }).then(x => x.json());
  assert.equal(cr.sent, 1, JSON.stringify(cr)); assert.equal(cr.removed, 1, 'abonnement expiré supprimé'); assert.ok(got.includes('/ok'));
  assert.equal(cr.skipped, 1, 'pas de notification si tous les combats sont déjà joués'); assert.ok(!got.includes('/alice'));
  const cr2 = await fetch(base + '/api/cron-notify', { headers: { Authorization: 'Bearer test-secret' } }).then(x => x.json());
  assert.ok(cr2.skipped, 'une seule fois par jour'); mock.close();
  r = await a('POST', '/api/logout', {}); r = await a('GET', '/api/me'); assert.equal(r.status, 401);
  console.log(`OK — rejeu identique, adversaire joueur vu : ${sawPlayer}, défenses de Bob : ${defs}, combats parallèles acceptés : ${okCount}`);
  server.close(); await require('../lib/app.js').close(); await pg.stop(); process.exit(0);
})().catch(e => { console.error('ÉCHEC', e); process.exit(1); });
