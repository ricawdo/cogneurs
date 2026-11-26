'use strict';
/* L'Arène des Cogneurs — logique serveur (Vercel + Postgres Supabase). */
const crypto = require('node:crypto');
const postgres = require('postgres');
const webpush = require('web-push');
const E = require('../public/engine.js');

/* Événement temporaire : à modifier pour en lancer un autre (nouvel id à chaque fois) */
const EVENT = { id: 'manif-paris-2026', title: 'Manif à Paris', end: Date.parse('2026-12-13T23:59:00+01:00'), xp: 2, underdogXp: 3, fpd: 4, winReward: 5 };
const evOn = () => Date.now() < EVENT.end;
const other = c => (c === 'manif' ? 'police' : 'manif');
const SESSION_DAYS = 30;
/* Élèves : XP gagnée par le maître quand un élève atteint ces niveaux, et combats bonus de l'élève le premier jour */
const PUPIL_REWARDS = { 3: 3, 5: 5, 10: 10 };
const PUPIL_FIRST_DAY_BONUS = 2;
/* Défense : XP gagnée quand un joueur t'attaque (victoire ou défaite), plafonnée par jour */
const DEFENSE_XP = 1, DEFENSE_XP_MAX = 3;
const SECURE_COOKIE = process.env.SECURE_COOKIE !== '0';

let sql = null;
function db() {
  if (!sql) {
    if (!process.env.DATABASE_URL) throw Object.assign(new Error('DATABASE_URL manquante'), { status: 503 });
    sql = postgres(process.env.DATABASE_URL, { prepare: false, max: +process.env.DB_MAX || 3, idle_timeout: 20, ssl: process.env.DB_SSL === '0' ? false : 'require', onnotice: () => {} });
  }
  return sql;
}

/* ---------- utilitaires ---------- */
const parisDay = () => new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
const rnd = a => a[crypto.randomInt(a.length)];
const SURN = ['Dupont','Martin','Bernard','Petit','Durand','Moreau','Lefebvre','Garnier','Roux','Fournier','Girard','Bonnet','Lambert','Mercier'];
const FIRST = ['Kévin','Jojo','Mimi','Lulu','Nono','Fanfan','Dédé','Titi','Zaza','Bibi','Riton','Gégé','Momo','Cricri','Pépette','Jeannot'];
const SYL = [['Gro','Bru','Kra','Zor','Bo','Tar','Mou','Rak','Fé','Gu','Spa','Pif','Ton','Bal','Ri','Choc','Ma'],['ba','go','ri','lo','du','ki','ne','','',''],['x','k','nar','bo','tor','us','ette','in','ard','ouille','ix','ac']];
const botName = camp => camp === 'police' ? 'Agent ' + rnd(SURN) : camp === 'manif' ? rnd(FIRST) + ' ' + rnd([...'BCDFGLMPRT']) + '.' : SYL.map(rnd).join('');
const NAME_RE = /^[\p{L}\d][\p{L}\d' -]{1,15}$/u;
const USER_RE = /^[a-zA-Z0-9_.-]{3,20}$/;
const HTTPError = (status, error) => Object.assign(new Error(error), { status, public: true });

const scrypt = (pw, salt) => new Promise((ok, ko) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? ko(e) : ok(k))));
async function hashPass(pw) { const salt = crypto.randomBytes(16); return 's1$' + salt.toString('base64') + '$' + (await scrypt(pw, salt)).toString('base64'); }
async function checkPass(pw, stored) {
  const [, s, k] = stored.split('$'); const key = await scrypt(pw, Buffer.from(s, 'base64')); const want = Buffer.from(k, 'base64');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
let DUMMY_HASH = null;

/* Limiteur anti-abus stocké en base (fonctionne même avec plusieurs instances) */
async function limited(ip, key, max, windowMs) {
  const k = key + '|' + ip, now = Date.now();
  const [{ n }] = await db()`select count(*)::int as n from rate_hits where k = ${k} and ts > ${now - windowMs}`;
  await db()`insert into rate_hits (k, ts) values (${k}, ${now})`;
  if (crypto.randomInt(50) === 0) await db()`delete from rate_hits where ts < ${now - 86400000}`;
  return n >= max;
}

/* ---------- sessions ---------- */
async function newSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db()`insert into sessions (token, user_id, expires) values (${token}, ${userId}, ${Date.now() + SESSION_DAYS * 864e5})`;
  return token;
}
const cookie = (token, maxAge) => `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE_COOKIE ? '; Secure' : ''}`;
async function currentUser(req) {
  const m = /(?:^|;\s*)sid=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [row] = await db()`select u.id, u.username, s.expires from sessions s join users u on u.id = s.user_id where s.token = ${m[1]}`;
  if (!row || Number(row.expires) < Date.now()) return null;
  return { id: Number(row.id), username: row.username, token: m[1] };
}

/* ---------- brutes ---------- */
async function loadBrute(userId, tx = db(), lock = false) {
  const [row] = lock ? await tx`select * from brutes where user_id = ${userId} for update` : await tx`select * from brutes where user_id = ${userId}`;
  return row ? { id: Number(row.id), masterId: row.master_id ? Number(row.master_id) : null, b: row.data, s: row.state } : null;
}
const saveBrute = (br, tx = db()) => tx`update brutes set data = ${tx.json(br.b)}, state = ${tx.json(br.s)}, level = ${br.b.level} where id = ${br.id}`;
const publicBrute = b => ({ name: b.name, camp: b.camp || 'classic', level: b.level, stats: b.stats, weapons: b.weapons, skills: b.skills, pets: b.pets, look: b.look, wins: b.wins, losses: b.losses });

async function scores(eventId, q = db()) {
  const rows = await q`select camp, points from event_scores where event_id = ${eventId}`;
  const s = { manif: 0, police: 0 }; for (const r of rows) s[r.camp] = r.points; return s;
}
async function campCounts(q = db()) {
  const rows = await q`select state->'ev'->>'camp' as camp, count(*)::int as n from brutes where state->'ev'->>'id' = ${EVENT.id} and state->'ev'->>'camp' is not null group by 1`;
  const c = { manif: 0, police: 0 }; for (const r of rows) c[r.camp] = r.n; return c;
}
/* Le camp en minorité (au moins 20 % de moins, et 5 joueurs en face) gagne XP ×3 au lieu de ×2 */
const underdog = c => (c.manif + 5 <= c.police || c.manif < c.police * 0.8) && c.police >= 5 ? 'manif' : (c.police + 5 <= c.manif || c.police < c.manif * 0.8) && c.manif >= 5 ? 'police' : null;

/* Compteurs du jour, ouverture et clôture de l'événement (avec récompense du camp gagnant) */
async function tick(br, q = db()) {
  const s = br.s, b = br.b, day = parisDay();
  if (s.day !== day) { s.day = day; s.fightsLeft = E.FPD; s.fought = { ar: [], ev: [] }; if (s.ev) s.ev.fightsLeft = EVENT.fpd; }
  if (!s.fought) s.fought = { ar: [], ev: [] };
  if (s.ev && (s.ev.id !== EVENT.id || !evOn())) {
    if (s.ev.camp && !s.ev.closed) {
      const sc = await scores(s.ev.id, q), winner = sc.manif === sc.police ? null : sc.manif > sc.police ? 'manif' : 'police';
      const won = winner === s.ev.camp;
      if (won) b.xp += EVENT.winReward;
      s.trophies = (s.trophies || []).concat({ title: s.ev.title || s.ev.id, camp: s.ev.camp, won, score: sc });
      s.news = won ? `Ton camp a remporté « ${s.ev.title || 'l’événement'} » : +${EVENT.winReward} XP !` : `« ${s.ev.title || 'L’événement'} » est terminé. Ton camp n’a pas gagné cette fois.`;
    }
    s.ev = null;
  }
  if (evOn() && !s.ev) s.ev = { id: EVENT.id, title: EVENT.title, camp: null, fightsLeft: EVENT.fpd, opps: [] };
}

/* Adversaires : vrais joueurs à ±2 niveaux, complétés par des bots */
/* Adversaires déjà affrontés aujourd'hui dans cette arène (« p:<id> » pour un joueur, « b:<nom> » pour un bot) */
const foughtKey = o => (o.t === 'p' ? 'p:' + o.id : 'b:' + o.name);
function foughtList(br, camp) { const k = camp ? 'ev' : 'ar'; br.s.fought = br.s.fought || { ar: [], ev: [] }; br.s.fought[k] = br.s.fought[k] || []; return br.s.fought[k]; }
async function makeOpps(br, camp, q = db()) {
  const L = br.b.level, out = [], done = foughtList(br, camp);
  const skip = done.filter(k => k.startsWith('p:')).map(k => Number(k.slice(2)));
  const rows = camp
    ? await q`select id from brutes where id <> ${br.id} and not (id = any(${skip}::bigint[])) and level between ${Math.max(1, L - 2)} and ${L + 2} and state->'ev'->>'id' = ${EVENT.id} and state->'ev'->>'camp' = ${camp} order by random() limit 3`
    : await q`select id from brutes where id <> ${br.id} and not (id = any(${skip}::bigint[])) and level between ${Math.max(1, L - 2)} and ${L + 2} order by random() limit 3`;
  for (const r of rows) out.push({ t: 'p', id: Number(r.id) });
  for (let tries = 0; out.length < 3 && tries < 50; tries++) {
    const o = { t: 'b', name: botName(camp || 'classic'), level: Math.max(1, L + crypto.randomInt(3) - 1) };
    if (!done.includes(foughtKey(o)) && !out.some(x => x.name === o.name)) out.push(o);
  }
  return out;
}
async function resolveOpp(o, camp, q = db()) {
  if (o.t === 'p') {
    const [row] = await q`select id, data from brutes where id = ${o.id}`;
    if (!row) return null;
    return { id: Number(row.id), b: camp ? Object.assign({}, row.data, { camp }) : row.data, bot: false };
  }
  return { id: null, b: E.npc(o.name, o.level, camp || 'classic'), bot: true };
}
function levelCheck(br) {
  const b = br.b, s = br.s;
  if (!s.pending && b.xp >= E.need(b.level)) {
    b.xp -= E.need(b.level); b.level++;
    s.pending = E.choices(b, E.RNG(E.H(b.name.toLowerCase() + '#' + b.level)));
    return true;
  }
  return false;
}

/* Message ajouté à la boîte de réception d'un autre joueur (sans écraser son état) */
const notify = (q, bruteId, msg, xp = 0) => q`update brutes set
  data = jsonb_set(data, '{xp}', to_jsonb(coalesce((data->>'xp')::int, 0) + ${xp})),
  state = jsonb_set(state, '{inbox}', coalesce(state->'inbox', '[]'::jsonb) || to_jsonb(${msg}::text))
  where id = ${bruteId}`;
/* Récompense le maître quand son élève atteint un palier */
async function pupilReward(br, tx) {
  const xp = PUPIL_REWARDS[br.b.level];
  if (br.masterId && xp) await notify(tx, br.masterId, `Ton élève ${br.b.name} a atteint le niveau ${br.b.level} : +${xp} XP !`, xp);
}

async function view(user) {
  let news = null;
  const br = await db().begin(async tx => {
    const br = await loadBrute(user.id, tx, true);
    if (!br) return null;
    await tick(br, tx); if (levelCheck(br)) await pupilReward(br, tx);
    if (!br.s.opps || br.s.opps.length !== 3) br.s.opps = await makeOpps(br, null, tx);
    if (br.s.ev && br.s.ev.camp && br.s.ev.opps.length !== 3) br.s.ev.opps = await makeOpps(br, other(br.s.ev.camp), tx);
    news = [...(br.s.news ? [br.s.news] : []), ...(br.s.inbox || [])]; delete br.s.news; delete br.s.inbox;
    if (!news.length) news = null;
    await saveBrute(br, tx);
    return br;
  });
  if (!br) return { user: { name: user.username }, brute: null };
  const opps = await Promise.all(br.s.opps.map(async o => { const r = await resolveOpp(o); return r && { ...publicBrute(r.b), bot: r.bot }; }));
  const ev = br.s.ev;
  const evOpps = ev && ev.camp ? await Promise.all(ev.opps.map(async o => { const r = await resolveOpp(o, other(ev.camp)); return r && { ...publicBrute(r.b), bot: r.bot }; })) : [];
  const rows = await db()`select id, won, xp, def_xp, event, a, b, brute_id from fights where brute_id = ${br.id} or opp_brute_id = ${br.id} order by id desc limit 10`;
  const hist = rows.map(f => { const mine = Number(f.brute_id) === br.id, o = mine ? f.b : f.a; return { id: Number(f.id), mine, won: mine ? f.won : !f.won, xp: mine ? f.xp : (f.def_xp || 0), ev: !!f.event, opp: o.name, lvl: o.level }; });
  const pupils = (await db()`select name, level from brutes where master_id = ${br.id} order by level desc, id asc limit 100`).map(p => ({ name: p.name, level: p.level }));
  const [master] = br.masterId ? await db()`select name, level from brutes where id = ${br.masterId}` : [];
  let event = null;
  if (ev) {
    const [sc, cc] = await Promise.all([scores(EVENT.id), campCounts()]);
    const ud = underdog(cc);
    event = { id: EVENT.id, title: EVENT.title, end: EVENT.end, xp: EVENT.xp, underdogXp: EVENT.underdogXp, underdog: ud, fpd: EVENT.fpd, winReward: EVENT.winReward, camp: ev.camp, fightsLeft: ev.fightsLeft, opps: evOpps, scores: sc, players: cc };
  }
  return {
    user: { name: user.username }, brute: publicBrute(br.b), xp: br.b.xp, need: E.need(br.b.level),
    fightsLeft: br.s.fightsLeft, fpd: E.FPD, pending: br.s.pending || null, opps, hist, event, news, trophies: br.s.trophies || [],
    pupils, master: master ? { name: master.name, level: master.level } : null, pupilRewards: PUPIL_REWARDS, pupilBonus: PUPIL_FIRST_DAY_BONUS, defenseXp: DEFENSE_XP, defenseXpMax: DEFENSE_XP_MAX, defXpToday: br.s.defDay === parisDay() ? (br.s.defXp || 0) : 0,
  };
}


/* ---------- notifications (Web Push) ---------- */
let VAPID = null;
async function vapid() {
  if (VAPID) return VAPID;
  let [row] = await db()`select value from kv where key = 'vapid'`;
  if (!row) {
    const k = webpush.generateVAPIDKeys();
    await db()`insert into kv (key, value) values ('vapid', ${JSON.stringify(k)}) on conflict (key) do nothing`;
    [row] = await db()`select value from kv where key = 'vapid'`;
  }
  VAPID = JSON.parse(row.value);
  webpush.setVapidDetails(process.env.PUSH_SUBJECT || 'https://cogneurs.vercel.app', VAPID.publicKey, VAPID.privateKey);
  return VAPID;
}
const parisHour = () => Number(new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }));

/* ---------- routes ---------- */
const routes = {
  'POST /api/register': async ({ body, ip }) => {
    if (await limited(ip, 'register', 5, 3600000)) throw HTTPError(429, 'Trop d’inscriptions depuis cette adresse. Réessaie plus tard.');
    const username = String(body.username || '').trim(), password = String(body.password || '');
    if (!USER_RE.test(username)) throw HTTPError(400, 'Nom d’utilisateur : 3 à 20 caractères, lettres, chiffres, point, tiret ou soulignement.');
    if (password.length < 8 || password.length > 200) throw HTTPError(400, 'Mot de passe : au moins 8 caractères.');
    const [exists] = await db()`select 1 from users where lower(username) = lower(${username})`;
    if (exists) throw HTTPError(409, 'Ce nom d’utilisateur est déjà pris.');
    let row;
    try { [row] = await db()`insert into users (username, pass, created) values (${username}, ${await hashPass(password)}, ${Date.now()}) returning id`; }
    catch (e) { if (e.code === '23505') throw HTTPError(409, 'Ce nom d’utilisateur est déjà pris.'); throw e; }
    const id = Number(row.id), token = await newSession(id);
    return [201, await view({ id, username }), { 'Set-Cookie': cookie(token, SESSION_DAYS * 86400) }];
  },
  'POST /api/login': async ({ body, ip }) => {
    if (await limited(ip, 'login', 10, 600000)) throw HTTPError(429, 'Trop d’essais. Attends quelques minutes.');
    const username = String(body.username || '').trim(), password = String(body.password || '');
    const [u] = await db()`select id, username, pass from users where lower(username) = lower(${username})`;
    if (!DUMMY_HASH) DUMMY_HASH = await hashPass(crypto.randomBytes(12).toString('hex'));
    const ok = (await checkPass(password, u ? u.pass : DUMMY_HASH)) && !!u;
    if (!ok) throw HTTPError(401, 'Nom d’utilisateur ou mot de passe incorrect.');
    await db()`delete from sessions where expires < ${Date.now()}`;
    const token = await newSession(Number(u.id));
    return [200, await view({ id: Number(u.id), username: u.username }), { 'Set-Cookie': cookie(token, SESSION_DAYS * 86400) }];
  },
  'POST /api/logout': async ({ user }) => {
    if (user) await db()`delete from sessions where token = ${user.token}`;
    return [200, { ok: true }, { 'Set-Cookie': cookie('', 0) }];
  },
  'GET /api/me': async ({ user }) => [200, await view(need(user))],
  'POST /api/brute': async ({ user, body }) => {
    need(user);
    if (await loadBrute(user.id)) throw HTTPError(409, 'Tu as déjà un cogneur.');
    const name = String(body.name || '').trim();
    if (!NAME_RE.test(name)) throw HTTPError(400, '2 à 16 caractères : lettres, chiffres, espaces, apostrophes ou tirets.');
    let master = null;
    const masterName = String(body.master || '').trim();
    if (masterName) {
      [master] = await db()`select id, name from brutes where lower(name) = lower(${masterName})`;
      if (!master) throw HTTPError(404, `Aucun cogneur ne s\u2019appelle « ${masterName.slice(0, 16)} ». Vérifie le nom du maître ou laisse le champ vide.`);
    }
    const b = E.base(name), st = { day: parisDay(), fightsLeft: E.FPD + (master ? PUPIL_FIRST_DAY_BONUS : 0), opps: [], pending: null, ev: null };
    if (master) st.inbox = [`Bienvenue, élève de ${master.name} ! Tu as ${PUPIL_FIRST_DAY_BONUS} combats bonus aujourd\u2019hui.`];
    try {
      await db().begin(async tx => {
        await tx`insert into brutes (user_id, name, level, data, state, master_id, created) values (${user.id}, ${b.name}, 1, ${tx.json(b)}, ${tx.json(st)}, ${master ? master.id : null}, ${Date.now()})`;
        if (master) await notify(tx, master.id, `Nouvel élève : ${b.name} a rejoint l\u2019arène grâce à toi !`);
      });
    } catch (e) { if (e.code === '23505') throw HTTPError(409, 'Ce nom de cogneur existe déjà. Chaque nom donne un cogneur unique : essaie une variante.'); throw e; }
    return [201, await view(user)];
  },
  'POST /api/levelup': async ({ user, body }) => {
    need(user);
    await db().begin(async tx => {
      const br = await loadBrute(user.id, tx, true);
      if (!br || !br.s.pending) throw HTTPError(400, 'Aucun bonus à choisir.');
      E.apply(br.b, br.s.pending[body.choice === 1 ? 1 : 0]); br.s.pending = null;
      if (levelCheck(br)) await pupilReward(br, tx);
      br.s.opps = []; if (br.s.ev) br.s.ev.opps = [];
      await saveBrute(br, tx);
    });
    return [200, await view(user)];
  },
  'POST /api/camp': async ({ user, body }) => {
    need(user);
    if (body.camp !== 'manif' && body.camp !== 'police') throw HTTPError(400, 'Camp inconnu.');
    await db().begin(async tx => {
      const br = await loadBrute(user.id, tx, true); if (!br) throw HTTPError(400, 'Crée d’abord ton cogneur.');
      await tick(br, tx);
      if (!br.s.ev) throw HTTPError(400, 'Aucun événement en cours.');
      if (br.s.ev.camp) throw HTTPError(409, 'Ton camp est déjà choisi pour cet événement.');
      br.s.ev.camp = body.camp; br.s.ev.opps = [];
      await saveBrute(br, tx);
    });
    return [200, await view(user)];
  },
  'POST /api/fight': async ({ user, body }) => {
    need(user);
    const isEv = body.kind === 'ev';
    const idx = Number.isInteger(body.idx) && body.idx >= 0 && body.idx < 3 ? body.idx : -1;
    if (idx < 0) throw HTTPError(400, 'Adversaire inconnu.');
    let out, defense = null;
    await db().begin(async tx => {
      const br = await loadBrute(user.id, tx, true); if (!br) throw HTTPError(400, 'Crée d’abord ton cogneur.');
      await tick(br, tx);
      if (br.s.pending) throw HTTPError(409, 'Choisis d’abord ton bonus de niveau.');
      if (isEv && (!br.s.ev || !br.s.ev.camp)) throw HTTPError(400, 'Choisis d’abord ton camp.');
      if (isEv ? br.s.ev.fightsLeft <= 0 : br.s.fightsLeft <= 0) throw HTTPError(429, 'Plus de combats pour aujourd’hui.');
      const camp = isEv ? br.s.ev.camp : null, list = isEv ? br.s.ev.opps : br.s.opps;
      const o = list && list[idx] && (await resolveOpp(list[idx], camp ? other(camp) : null, tx));
      if (!o) throw HTTPError(409, 'Cet adversaire n’est plus disponible.');
      if (foughtList(br, camp).includes(foughtKey(list[idx]))) throw HTTPError(409, 'Tu as déjà affronté ce cogneur aujourd’hui dans cette arène.');
      const pa = publicBrute(camp ? Object.assign({}, br.b, { camp }) : br.b), pb = publicBrute(o.b);
      const seed = crypto.randomInt(2 ** 31), { win } = E.simulate(pa, pb, E.RNG(seed)), won = win === 0;
      let mult = 1;
      if (isEv) mult = underdog(await campCounts(tx)) === camp ? EVENT.underdogXp : EVENT.xp;
      const gain = E.xpGain(br.b.level, o.b.level, won) * mult;
      br.b.xp += gain; won ? br.b.wins++ : br.b.losses++;
      if (isEv) br.s.ev.fightsLeft--; else br.s.fightsLeft--;
      foughtList(br, camp).push(foughtKey(list[idx]));
      const leveled = levelCheck(br);
      if (leveled) await pupilReward(br, tx);
      br.s.opps = await makeOpps(br, null, tx);
      if (isEv) br.s.ev.opps = await makeOpps(br, other(camp), tx);
      await saveBrute(br, tx);
      const [fr] = await tx`insert into fights (brute_id, opp_brute_id, a, b, seed, won, xp, event, created) values (${br.id}, ${o.id}, ${tx.json(pa)}, ${tx.json(pb)}, ${seed}, ${won}, ${gain}, ${isEv ? EVENT.id : null}, ${Date.now()}) returning id`;
      if (o.id) defense = { fightId: Number(fr.id), bruteId: o.id };
      if (isEv && won) await tx`insert into event_scores (event_id, camp, points) values (${EVENT.id}, ${camp}, 1) on conflict (event_id, camp) do update set points = event_scores.points + 1`;
      out = { A: pa, B: pb, seed, won, gain, leveled, ev: isEv, mult, bot: o.bot };
    });
    /* Le défenseur gagne un peu d'XP à chaque défense, gagnée ou perdue (plafonné chaque jour).
       Fait après la transaction pour ne jamais bloquer deux joueurs qui s'attaquent en même temps. */
    if (defense) {
      const day = parisDay();
      const upd = await db()`update brutes set
          data = jsonb_set(data, '{xp}', to_jsonb(coalesce((data->>'xp')::int, 0) + ${DEFENSE_XP})),
          state = jsonb_set(jsonb_set(state, '{defDay}', to_jsonb(${day}::text)), '{defXp}',
            to_jsonb(case when state->>'defDay' = ${day} then coalesce((state->>'defXp')::int, 0) + ${DEFENSE_XP} else ${DEFENSE_XP} end))
        where id = ${defense.bruteId} and (state->>'defDay' is distinct from ${day} or coalesce((state->>'defXp')::int, 0) < ${DEFENSE_XP_MAX})
        returning id`;
      if (upd.length) await db()`update fights set def_xp = ${DEFENSE_XP} where id = ${defense.fightId}`;
    }
    return [200, out];
  },
  'GET /api/replay': async ({ user, url }) => {
    need(user);
    const id = Number(url.searchParams.get('id'));
    if (!Number.isSafeInteger(id)) throw HTTPError(400, 'Identifiant invalide.');
    const [f] = await db()`select * from fights where id = ${id}`;
    if (!f) throw HTTPError(404, 'Combat introuvable.');
    return [200, { A: f.a, B: f.b, seed: Number(f.seed), won: f.won, gain: f.xp, ev: !!f.event, replay: true }];
  },
  'GET /api/push-key': async () => [200, { key: (await vapid()).publicKey }],
  'POST /api/push': async ({ user, body }) => {
    need(user);
    const sub = body.subscription || {};
    const endpoint = String(sub.endpoint || ''), keys = sub.keys || {};
    if (!/^https:\/\/[^\s]{10,900}$/.test(endpoint) || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100)
      throw HTTPError(400, 'Abonnement aux notifications invalide.');
    const clean = { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
    await db()`insert into push_subs (user_id, endpoint, sub, created) values (${user.id}, ${endpoint}, ${db().json(clean)}, ${Date.now()})
      on conflict (endpoint) do update set user_id = excluded.user_id, sub = excluded.sub`;
    return [200, { ok: true }];
  },
  'POST /api/push-off': async ({ user, body }) => {
    need(user);
    await db()`delete from push_subs where user_id = ${user.id} and endpoint = ${String(body.endpoint || '')}`;
    return [200, { ok: true }];
  },
  /* Appelé chaque matin par la tâche planifiée de Vercel (vercel.json) : prévient que les combats sont rechargés.
     Protégé : une seule fois par jour, et seulement le matin (sauf appel authentifié avec CRON_SECRET). */
  'GET /api/cron-notify': async ({ req }) => {
    const authed = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
    const h = parisHour();
    if (!authed && (h < 6 || h > 12)) return [200, { skipped: 'hors horaire' }];
    const day = parisDay();
    const claimed = await db()`insert into kv (key, value) values ('notify_day', ${day}) on conflict (key) do update set value = excluded.value where kv.value <> ${day} returning key`;
    if (!claimed.length) return [200, { skipped: 'déjà envoyé aujourd\u2019hui' }];
    await vapid();
    const subs = await db()`select s.id, s.sub, b.name from push_subs s join brutes b on b.user_id = s.user_id`;
    const ev = evOn();
    let sent = 0, removed = 0;
    for (let i = 0; i < subs.length; i += 25) {
      await Promise.all(subs.slice(i, i + 25).map(async s => {
        const payload = JSON.stringify({
          title: 'Tes combats sont prêts !',
          body: `${s.name} a récupéré ses ${E.FPD} combats${ev ? ` et ${EVENT.fpd} combats bonus Manif` : ''}. Viens te battre !`,
          url: '/',
        });
        try { await webpush.sendNotification(s.sub, payload, { TTL: 6 * 3600, urgency: 'normal' }); sent++; }
        catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { await db()`delete from push_subs where id = ${s.id}`; removed++; } else console.error('push', e.statusCode, e.body, e.message); }
      }));
    }
    return [200, { sent, removed, total: subs.length }];
  },
  'GET /api/top': async () => {
    const rows = await db()`select data from brutes order by level desc, (data->>'xp')::int desc, (data->>'wins')::int desc, id asc limit 20`;
    const masters = await db()`select m.data, count(p.id)::int as pupils from brutes p join brutes m on m.id = p.master_id group by m.id order by pupils desc, m.level desc, m.id asc limit 10`;
    const card = b => ({ name: b.name, level: b.level, wins: b.wins, losses: b.losses, look: b.look, weapon: b.weapons[0] || null });
    return [200, { brutes: rows.map(r => card(r.data)), masters: masters.map(r => ({ ...card(r.data), pupils: r.pupils })) }];
  },
};
function need(user) { if (!user) throw HTTPError(401, 'Non connecté.'); return user; }

/* ---------- point d'entrée HTTP (Vercel ou serveur local) ---------- */
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store' };
async function readBody(req) {
  if (req.body !== undefined && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body || {};
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 10000) throw HTTPError(413, 'Requête trop grosse.'); }
  return raw ? JSON.parse(raw) : {};
}
async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const send = (code, obj, headers = {}) => { res.writeHead(code, { ...SEC, 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(obj)); };
  const h = routes[req.method + ' ' + url.pathname];
  if (!h) return send(404, { error: 'Route inconnue.' });
  /* Protection CSRF : les écritures doivent être du JSON (un formulaire d'un autre site ne peut pas en envoyer) */
  if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'JSON attendu.' });
  try {
    let body;
    try { body = await readBody(req); } catch (e) { if (e.public) throw e; throw HTTPError(400, 'JSON invalide.'); }
    const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const user = await currentUser(req);
    const [code, obj, headers] = await h({ req, body: body || {}, ip, user, url });
    send(code, obj, headers);
  } catch (e) {
    if (e.public) return send(e.status, { error: e.message });
    if (e.status === 503) return send(503, { error: 'Base de données non configurée.' });
    console.error(e);
    send(500, { error: 'Erreur du serveur.' });
  }
}
module.exports = { handler, close: () => sql && sql.end({ timeout: 1 }) };
