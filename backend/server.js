// BioBes API (MVP) — auth + sinkronizim state + wipe. Aiven Postgres + Render.
const express = require('express');
const crypto = require('crypto');
const { getPool, dbOk } = require('./db');
const { migrate } = require('./migrate');
const { validateState } = require('./validateState');
const { ensureAdmin, loginUser, userFromToken, logoutToken, rateLimit, verifyPassword, hashPassword, groupsForUser } = require('./auth');
const access = require('./access');
const companies = require('./companies');
const events = require('./events');
const zlib = require('zlib');

const app = express();
app.set('trust proxy', 1); // Render: IP reale e klientit për rate-limit
const PORT = process.env.PORT || 3000;
const MAX_STATE_BYTES = 25 * 1024 * 1024; // njëjtë me RESTORE_MAX_BYTES në frontend

// CORS minimal (MVP): origjina e frontend-it ose * nëse nuk është vendosur.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '30mb' }));

// Kompresim gzip për përgjigjet JSON > 1 KB (gjendja është ~2.7 MB → shkarkohet
// disa herë më shpejt). Pa varësi të reja: zlib i Node-it.
app.use((req, res, next) => {
  if (!/gzip/.test(String(req.headers['accept-encoding'] || ''))) return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    try {
      const raw = Buffer.from(JSON.stringify(body));
      if (raw.length > 1024) {
        const gz = zlib.gzipSync(raw, { level: 6 });
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', gz.length);
        return res.end(gz);
      }
    } catch (e) { /* në rast dështimi dërgohet e pakompresuar */ }
    return json(body);
  };
  next();
});

function needDb(req, res, next) {
  if (!getPool()) return res.status(503).json({ ok: false, error: 'Databaza nuk është e lidhur (DATABASE_URL mungon)' });
  next();
}

async function needAuth(req, res, next) {
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = await userFromToken(tok).catch(() => null);
  if (!user) return res.status(401).json({ ok: false, error: 'Sesioni ka skaduar — hyni përsëri' });
  req.user = user;
  // Konteksti i qasjes (modulet + superuser) sipas skemës Odoo.
  try {
    req.access = await access.loadAccessContext(user);
  } catch (e) {
    console.error('[access] loadAccessContext:', e.message);
    // Dështim i sigurt (deny): jomodul për user jo-superuser, bypass për admin.
    const su = access.isSuperuser(user);
    req.access = { user, superuser: su, modules: su ? null : { full: false, allowedModules: [], allowedFields: [] }, allowedModules: [] };
  }
  next();
}

function needAdminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'ROLE-ADMIN') return res.status(403).json({ ok: false, error: 'Kërkohet rol administratori' });
  next();
}

// Middleware Odoo: kërkon të drejtën `action` mbi `model` (ir.model.access).
function needAccess(model, action) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ ok: false, error: 'Sesioni ka skaduar — hyni përsëri' });
      if (access.isSuperuser(req.user)) return next();
      const a = await access.modelAccess(req.user.id, model, null, req.company || null);
      if (!access.checkAccess(a, action)) {
        return res.status(403).json({ ok: false, error: 'Nuk keni të drejtë për këtë veprim (' + model + ':' + action + ')' });
      }
      next();
    } catch (e) { console.error('[access] needAccess:', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
  };
}

async function audit(actor, action, detail, companyId) {
  try {
    await getPool().query('INSERT INTO audit_log(actor,action,detail,company_id) VALUES($1,$2,$3,$4)', [actor || '', action, detail || '', companyId || null]);
  } catch (e) { console.error('[audit]', e.message); }
}

app.get('/api/health', async (req, res) => {
  let companyCount = null;
  try { if (getPool()) { const r = await getPool().query('SELECT COUNT(*)::int AS c FROM companies'); companyCount = r.rows[0].c; } } catch (e) { companyCount = null; }
  res.json({ ok: true, db: await dbOk(), version: 1, syncPolicy: access.SYNC_ALL_MODULES_FOR_SERVER_USERS ? 'all-modules' : 'per-group', defaultCompany: companies.DEFAULT_COMPANY_ID, companies: companyCount, time: new Date().toISOString() });
});

app.post('/api/auth/login', rateLimit(10, 15 * 60 * 1000), needDb, async (req, res) => {
  const { username, password } = req.body || {};
  let r;
  try { r = await loginUser(username, password); }
  catch (e) { console.error('[login]', e.message); return res.status(503).json({ ok: false, error: 'Databaza nuk përgjigjet' }); }
  if (!r) return res.status(401).json({ ok: false, error: 'Kredenciale të gabuara' });
  await audit(r.user.username, 'LOGIN', 'Hyrje në API');
  let ctx = {};
  try { ctx = await companies.contextFor(r.user); } catch (e) { console.error('[login:companies]', e.message); }
  res.json({ ok: true, token: r.token, user: r.user, modules: r.modules, ...ctx });
});

app.post('/api/auth/logout', needAuth, async (req, res) => {
  await logoutToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  res.json({ ok: true });
});

app.get('/api/auth/me', needDb, needAuth, async (req, res) => {
  try {
    const groups = await groupsForUser(req.user.id);
    const ctx = await companies.contextFor(req.user);
    // Të drejtat per kompani: ?company=C2 kthen grupet/modulet e asaj kompanie.
    const wanted = String((req.query && req.query.company) || '').trim();
    let ctxCompany = wanted || ctx.defaultCompany || companies.DEFAULT_COMPANY_ID;
    if (wanted) {
      const a = await companies.assertCompanyAccess(req.user, wanted);
      if (!a.ok) return res.status(a.code || 403).json({ ok: false, error: a.error });
      ctxCompany = a.id;
    }
    let accessCtx = req.access;
    if (!req.access || req.access.superuser === false) accessCtx = await access.loadAccessContext(req.user, null, ctxCompany);
    res.json({ ok: true, user: req.user, groups, modules: accessCtx.modules, superuser: accessCtx.superuser, company: ctxCompany, ...ctx });
  } catch (e) { console.error('[auth:me]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.get('/api/state/version', needDb, needAuth, companies.needCompany(), async (req, res) => {
  try {
    const { rows } = await getPool().query('SELECT version,updated_at FROM app_state WHERE id=$1', [req.company]);
    res.json({ ok: true, company: req.company, version: rows.length ? rows[0].version : 0, updatedAt: rows.length ? rows[0].updated_at : null });
  } catch (e) { console.error('[state:version]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.post('/api/auth/password', needDb, needAuth, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 8) return res.status(400).json({ ok: false, error: 'Fjalëkalimi min 8 karaktere' });
    const p = getPool();
    const me = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const meh = crypto.createHash('sha256').update(String(me)).digest('hex');
    await p.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(password), req.user.id]);
    await p.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2', [req.user.id, meh]);
    await audit(req.user.username, 'PASSWORD_CHANGE', 'Fjalëkalimi u ndryshua');
    res.json({ ok: true });
  } catch (e) { console.error('[auth:password]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.post('/api/auth/forgot', rateLimit(5, 15 * 60 * 1000), needDb, async (req, res) => {
  try {
    const { isMailConfigured, sendResetCode } = require('./mailer');
    const un = String((req.body || {}).username || '').trim();
    if (!isMailConfigured()) return res.status(503).json({ ok: false, error: 'Shërbimi email nuk është konfiguruar — kontakto administratorin' });
    const p = getPool();
    const cur = await p.query('SELECT * FROM users WHERE username=$1', [un]);
    const u = cur.rows[0];
    if (u && u.active && (u.email || '').includes('@')) {
      const code = String(crypto.randomInt(100000, 1000000));
      const ch = crypto.createHash('sha256').update(u.id + ':' + code).digest('hex');
      await p.query("INSERT INTO password_resets(username,code_hash,expires_at,attempts) VALUES($1,$2,NOW()+INTERVAL '15 minutes',0) ON CONFLICT(username) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,attempts=0", [u.username, ch]);
      try { await sendResetCode(u.email, u.username, code); }
      catch (e) { console.error('[auth:forgot:mail]', e.message); return res.status(502).json({ ok: false, error: 'Emaili nuk u dërgua — provo përsëri ose kontakto administratorin' }); }
      await audit(u.username, 'PASSWORD_FORGOT', 'Kodi u dërgua');
    }
    res.json({ ok: true });
  } catch (e) { console.error('[auth:forgot]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.post('/api/auth/reset', rateLimit(10, 15 * 60 * 1000), needDb, async (req, res) => {
  try {
    const { username, code, password } = req.body || {};
    if (!password || String(password).length < 8) return res.status(400).json({ ok: false, error: 'Fjalëkalimi min 8 karaktere' });
    const un = String(username || '').trim();
    const cd = String(code || '').trim();
    if (!un || !/^\d{6}$/.test(cd)) return res.status(400).json({ ok: false, error: 'Kodi gabim' });
    const p = getPool();
    const cur = await p.query('SELECT * FROM users WHERE username=$1', [un]);
    const u = cur.rows[0];
    const rr = await p.query('SELECT * FROM password_resets WHERE username=$1', [un]);
    const r = rr.rows[0];
    let bad = 'Kodi gabim ose i skaduar';
    if (u && u.active && r && r.expires_at && new Date(r.expires_at).getTime() > Date.now() && (r.attempts || 0) < 5) {
      const ch = crypto.createHash('sha256').update(u.id + ':' + cd).digest('hex');
      const a = Buffer.from(ch), b = Buffer.from(r.code_hash || '');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        await p.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(password), u.id]);
        await p.query('DELETE FROM password_resets WHERE username=$1', [un]);
        await p.query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
        await audit(u.username, 'PASSWORD_RESET', 'U rivendos me email');
        return res.json({ ok: true });
      }
      await p.query('UPDATE password_resets SET attempts=attempts+1 WHERE username=$1', [un]);
      bad = 'Kodi gabim';
    }
    return res.status(400).json({ ok: false, error: bad });
  } catch (e) { console.error('[auth:reset]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.get('/api/state', needDb, needAuth, companies.needCompany(), async (req, res) => {
  try {
    const { rows } = await getPool().query('SELECT data,version,updated_at FROM app_state WHERE id=$1', [req.company]);
    const wipedAt = await companies.getWipeMark(getPool(), req.company);
    if (!rows.length) return res.json({ ok: true, state: null, version: 0, updatedAt: null, wipedAt, company: req.company, modules: req.access.modules });
    // Qasja sipas moduleve (Odoo): superuser/Administrator sheh gjithçka; të tjerët vetëm modulet e tyre.
    const state = access.applyStateModules(rows[0].data, req.access.modules);
    res.json({ ok: true, state, version: rows[0].version, updatedAt: rows[0].updated_at, wipedAt, company: req.company, modules: req.access.modules });
  } catch (e) { console.error('[state:get]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.put('/api/state', needDb, needAuth, companies.needCompany(), async (req, res) => {
  try {
    const { state, baseVersion, wipeAck } = req.body || {};
    const COMPANY = req.company;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return res.status(400).json({ ok: false, error: 'State i pavlefshëm' });
    }
    const p = getPool();

    // Qasja sipas moduleve (Odoo): një user jo-superuser shkruan vetëm modulet
    // që i takojnë; fushat e tjera mbahen siç janë në server (nuk i fshin të tjerët).
    let stateToStore = state;
    if (req.access && req.access.superuser === false) {
      const scoped = access.applyStateModules(state, req.access.modules);
      const onlyFields = (req.access.modules && req.access.modules.allowedFields) || [];
      const vscoped = validateState(scoped, { onlyFields });
      if (!vscoped.ok) return res.status(400).json({ ok: false, error: 'Serveri refuzoi ruajtjen: ' + vscoped.errors[0], errors: vscoped.errors });
      // Merge me gjendjen aktuale: ruaj fushat e tjera siç janë.
      const cur = await p.query('SELECT data FROM app_state WHERE id=$1', [COMPANY]);
      const base = (cur.rows.length && cur.rows[0].data && typeof cur.rows[0].data === 'object' && !Array.isArray(cur.rows[0].data))
        ? cur.rows[0].data : {};
      stateToStore = Object.assign({}, base, scoped);
      const vfull = validateState(stateToStore);
      if (!vfull.ok) return res.status(400).json({ ok: false, error: 'Serveri refuzoi ruajtjen: ' + vfull.errors[0], errors: vfull.errors });
    } else {
      const vstate = validateState(state);
      if (!vstate.ok) return res.status(400).json({ ok: false, error: 'Serveri refuzoi ruajtjen: ' + vstate.errors[0], errors: vstate.errors });
    }

    const raw = JSON.stringify(stateToStore);
    if (raw.length > MAX_STATE_BYTES) return res.status(413).json({ ok: false, error: 'State tejkalon 25 MB' });

    const wipedMark = await companies.getWipeMark(p, COMPANY);
    const clearWipeMark = async () => { try { await companies.clearWipeMark(p, COMPANY); } catch (e) {} };
    if (wipedMark && wipeAck !== wipedMark) {
      return res.status(409).json({ ok: false, error: 'Serveri u pastrua totalisht — pajisja duhet të pastrohet ose të rifillojë epokën', wiped: true, wipedAt: wipedMark });
    }
    if (baseVersion === undefined || baseVersion === null) {
      // Blind write (first push / legacy client): single-statement atomic increment.
      const r = await p.query(
        `INSERT INTO app_state(id,company_id,data,version,updated_at) VALUES($1,$1,$2::jsonb,1,NOW())
         ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,version=app_state.version+1,updated_at=NOW(),company_id=EXCLUDED.company_id RETURNING version`,
        [COMPANY, raw]
      );
      const ver = r.rows[0].version;
      await audit(req.user.username, 'STATE_PUT', 'company ' + COMPANY + ' version ' + ver + ' (blind)' + (req.access.superuser ? '' : ' modules=' + (req.access.modules.allowedModules || []).join(',')), COMPANY);
      await clearWipeMark();
      events.stateChanged(COMPANY, ver, req.user.username);
      return res.json({ ok: true, version: ver, company: COMPANY, updatedAt: new Date().toISOString() });
    }
    if (!Number.isFinite(+baseVersion)) {
      return res.status(400).json({ ok: false, error: 'baseVersion i pavlefshëm' });
    }
    // Atomic compare-and-swap: check + write in ONE statement, no lost-update race.
    const r = await p.query(
      `UPDATE app_state SET data=$1::jsonb,version=version+1,updated_at=NOW()
       WHERE id=$2 AND version=$3 RETURNING version`,
      [raw, COMPANY, +baseVersion]
    );
    if (!r.rows.length) {
      const cur = await p.query('SELECT version FROM app_state WHERE id=$1', [COMPANY]);
      if (!cur.rows.length && +baseVersion === 0) {
        // Fresh DB: first guarded write creates the row (insert race -> 409 below).
        const ins = await p.query(
          `INSERT INTO app_state(id,company_id,data,version,updated_at) VALUES($1,$1,$2::jsonb,1,NOW())
           ON CONFLICT(id) DO NOTHING RETURNING version`,
          [COMPANY, raw]
        );
        if (ins.rows.length) {
          await audit(req.user.username, 'STATE_PUT', 'company ' + COMPANY + ' version 1 (init)', COMPANY);
          await clearWipeMark();
          events.stateChanged(COMPANY, 1, req.user.username);
          return res.json({ ok: true, version: 1, company: COMPANY, updatedAt: new Date().toISOString() });
        }
      }
      const cur2 = await p.query('SELECT version FROM app_state WHERE id=$1', [COMPANY]);
      const ver = cur2.rows.length ? cur2.rows[0].version : 0;
      return res.status(409).json({ ok: false, error: 'Konflikt versionesh — ringarko state-in', version: ver });
    }
    const ver = r.rows[0].version;
    await audit(req.user.username, 'STATE_PUT', 'company ' + COMPANY + ' version ' + ver + (req.access.superuser ? '' : ' modules=' + (req.access.modules.allowedModules || []).join(',')), COMPANY);
    await clearWipeMark();
    events.stateChanged(COMPANY, ver, req.user.username);
    res.json({ ok: true, version: ver, company: COMPANY, updatedAt: new Date().toISOString() });
  } catch (e) { console.error('[state:put]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// ===== Ruajtja PËR DOKUMENT (F2.3) ==========================================
// Në vend që pajisja tё dërgojë gjithё gjendjen (~2.7 MB), dërgon vetёm dokumentet
// e ndryshuara: [{kind:'suppliers', op:'upsert'|'delete', id, doc}]. Serveri i
// aplikon brenda njё transaksioni me bllokim rreshti (FOR UPDATE), rrit versionin,
// njofton pajisjet e tjera (SSE) dhe kthen versionin e ri — pa mbishkrime tё fshehta.
const PATCH_MAX_OPS = 500;
const PATCH_MAX_BYTES = 1024 * 1024;

const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

// Kontroll PËR DOKUMENT: nëse op-i sjell `prev` (vlera që pajisja mendon se ka
// serveri), atëherë krahasohet me vlerën aktuale BRENDA transaksionit. Kështu dy
// pajisje që shkruajnë dokumente TË NDRYSHME kalojnë të dyja pa konflikt, ndërsa
// për dokumentin E NJËJTË zbulohet mbishkrimi dhe kërkohet ringarkim/paraqitje.
function applyStateOps(base, ops, allowedFields) {
  const next = Object.assign({}, base || {});
  let changed = 0;
  for (const raw of ops) {
    const op = raw || {};
    const kind = String(op.kind || '');
    if (!kind) { const e = new Error('Dokumenti pa fushë (kind)'); e.code = 400; throw e; }
    if (allowedFields && !allowedFields.includes(kind)) { const e = new Error('Nuk keni të drejtë për fushën ' + kind); e.code = 403; throw e; }
    const hasPrev = Object.prototype.hasOwnProperty.call(op, 'prev');
    if (op.op === 'set') {                       // vlerë e vetme (meta, settings, …)
      if (hasPrev && !same(next[kind], op.prev)) { const e = new Error('Dokumenti u ndryshua nga një përdorues tjetër'); e.code = 409; e.kind = kind; e.current = next[kind]; throw e; }
      if (!same(next[kind], op.doc)) { next[kind] = op.doc; changed++; }
      continue;
    }
    if (!Array.isArray(next[kind])) {
      if (op.op === 'delete') continue;          // asgjë për të fshirë
      next[kind] = [];
    }
    const id = String(op.id == null ? '' : op.id);
    if (!id) { const e = new Error('Dokumenti pa identifikues (id)'); e.code = 400; throw e; }
    const list = next[kind];
    const at = list.findIndex((x) => x && String(x.id) === id);
    const current = at >= 0 ? list[at] : null;
    if (hasPrev && !same(current, op.prev || null)) {
      const e = new Error('Dokumenti u ndryshua nga një përdorues tjetër');
      e.code = 409; e.kind = kind; e.id = id; e.current = current; throw e;
    }
    if (op.op === 'delete') {
      if (at >= 0) { list.splice(at, 1); changed++; }
      continue;
    }
    if (op.op !== 'upsert') { const e = new Error('Veprim i panjohur: ' + op.op); e.code = 400; throw e; }
    if (!op.doc || typeof op.doc !== 'object' || Array.isArray(op.doc)) { const e = new Error('Dokumenti i pavlefshëm'); e.code = 400; throw e; }
    if (at >= 0) {
      if (!same(list[at], op.doc)) { list[at] = op.doc; changed++; }
    } else { list.push(op.doc); changed++; }
  }
  return { next, changed };
}

app.post('/api/state/patch', needDb, needAuth, companies.needCompany(), async (req, res) => {
  try {
    const COMPANY = req.company;
    const ops = (req.body && req.body.ops) || null;
    const baseVersion = req.body ? req.body.baseVersion : undefined;
    if (!Array.isArray(ops) || !ops.length) return res.status(400).json({ ok: false, error: 'Kërkohet lista `ops`' });
    if (ops.length > PATCH_MAX_OPS) return res.status(413).json({ ok: false, error: 'Shumë ndryshime njëherësh (' + ops.length + ' > ' + PATCH_MAX_OPS + ')' });
    const rawOps = JSON.stringify(ops);
    if (rawOps.length > PATCH_MAX_BYTES) return res.status(413).json({ ok: false, error: 'Ndryshimet tejkalojnë 1 MB — përdoret ruajtja e plotë' });

    const p = getPool();
    const allowedFields = (req.access && req.access.superuser === false && req.access.modules) ? req.access.modules.allowedFields : null;

    const wipedMark = await companies.getWipeMark(p, COMPANY);
    const wipeAck = req.body ? req.body.wipeAck : null;
    if (wipedMark && wipeAck !== wipedMark) {
      return res.status(409).json({ ok: false, error: 'Serveri u pastrua totalisht — pajisja duhet të pastrohet', wiped: true, wipedAt: wipedMark });
    }

    // Transaksion + bllokim rreshti: dy pajisje që shkruajnë dokumente të ndryshme
    // nuk mbishkruajnë njëra-tjetrën (pa humbje të dhënash).
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query('SELECT data,version FROM app_state WHERE id=$1 FOR UPDATE', [COMPANY]);
      if (!cur.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: 'Serveri nuk ka gjendje — dërgohet e plotë', empty: true, version: 0 });
      }
      const version = cur.rows[0].version;
      // Versioni global është KËSHILLUES: ndryshimet janë incrementale (per dokument),
      // ndaj një version i vjetër nuk e humb punën e askujt. Konflikti zbulohet vetëm
      // për dokumentin e njëjtë, kur op-i sjell `prev` (shih applyStateOps).
      let out;
      try { out = applyStateOps(cur.rows[0].data, ops, allowedFields); }
      catch (e) {
        await client.query('ROLLBACK');
        return res.status(e.code || 400).json({
          ok: false, error: e.message, conflict: e.code === 409, kind: e.kind, id: e.id, current: e.current, version,
        });
      }
      const data = out.next;
      const vfull = validateState(data);
      if (!vfull.ok) { await client.query('ROLLBACK'); return res.status(400).json({ ok: false, error: 'Serveri refuzoi ruajtjen: ' + vfull.errors[0] }); }
      const raw = JSON.stringify(data);
      if (raw.length > MAX_STATE_BYTES) { await client.query('ROLLBACK'); return res.status(413).json({ ok: false, error: 'State tejkalon 25 MB' }); }
      const upd = await client.query('UPDATE app_state SET data=$1::jsonb,version=version+1,updated_at=NOW() WHERE id=$2 RETURNING version', [raw, COMPANY]);
      await client.query('COMMIT');
      const ver = upd.rows[0].version;
      const kinds = Array.from(new Set(ops.map((o) => String(o.kind)))).join(',');
      await audit(req.user.username, 'STATE_PATCH', 'company ' + COMPANY + ' version ' + ver + ' / ' + out.changed + ' ndryshime / ' + kinds, COMPANY);
      await companies.clearWipeMark(p, COMPANY).catch(() => {});
      events.stateChanged(COMPANY, ver, req.user.username, { patch: true, ops: out.changed, kinds });
      return res.json({ ok: true, version: ver, company: COMPANY, applied: out.changed, kinds });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_e) {}
      throw e;
    } finally {
      try { client.release(); } catch (e) {}
    }
  } catch (e) { console.error('[state:patch]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.get('/api/audit', needDb, needAuth, needAccess('audit', 'read'), async (req, res) => {
  try {
    const lim = Math.min(Math.max(+req.query.limit || 100, 1), 500);
    const co = String(req.query.company || '').trim();
    const { rows } = co
      ? await getPool().query('SELECT id,at,actor,action,detail,company_id FROM audit_log WHERE company_id=$1 ORDER BY id DESC LIMIT $2', [co, lim])
      : await getPool().query('SELECT id,at,actor,action,detail,company_id FROM audit_log ORDER BY id DESC LIMIT $1', [lim]);
    res.json({ ok: true, rows });
  } catch (e) { console.error('[audit]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// Administrim përdoruesish (vetëm admin).
app.get('/api/admin/users', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const p = getPool();
    const { rows } = await p.query('SELECT id,username,name,role,active,email,rights,created_at FROM users ORDER BY created_at');
    const ug = await p.query(
      `SELECT ug.user_id, g.id, g.name, g.full_name, g.module_id
       FROM user_groups ug JOIN access_groups g ON g.id = ug.group_id ORDER BY g.full_name`);
    const byUser = {};
    for (const r of ug.rows) (byUser[r.user_id] = byUser[r.user_id] || []).push({ id: r.id, name: r.name, full_name: r.full_name, module_id: r.module_id });
    const users = rows.map((u) => ({ ...u, groups: byUser[u.id] || [] }));
    res.json({ ok: true, users });
  } catch (e) { console.error('[users:list]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});
app.post('/api/admin/users', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const { username, password, name, role, rights, email } = req.body || {};
    const un = String(username || '').trim();
    if (un.length < 3) return res.status(400).json({ ok: false, error: 'Përdoruesi min 3 karaktere' });
    if (!password || String(password).length < 8) return res.status(400).json({ ok: false, error: 'Fjalëkalimi min 8 karaktere' });
    const em = String(email || '').trim();
    if (em && !em.includes('@')) return res.status(400).json({ ok: false, error: 'Email i pavlefshëm' });
    const r = String(role || 'ROLE-USER');
    const id = 'USR-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const p = getPool();
    await p.query('INSERT INTO users(id,username,name,role,password_hash,rights,email) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',
      [id, un, String(name || ''), r, hashPassword(password), (rights && typeof rights === 'object') ? JSON.stringify(rights) : null, em]);
    // Anëtarësia: kompanitë e kërkuara, ose të gjitha kompanitë aktive me të parazgjedhurën (pa 'company' → sjellje e vjetër).
    try {
      const want = Array.isArray((req.body || {}).companies) && req.body.companies.length
        ? req.body.companies.map((c) => (typeof c === 'string' ? { id: c } : (c || {}))).filter((c) => c.id)
        : (await companies.listCompanies()).filter((c) => c.active !== false).map((c) => ({ id: c.id }));
      const dft = ((want.find((c) => c.isDefault || c.is_default) || want[0]) || {}).id || companies.DEFAULT_COMPANY_ID;
      for (const c of want) {
        await p.query('INSERT INTO user_companies(user_id,company_id,is_default) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [id, c.id, String(c.id) === dft]);
      }
    } catch (e) { console.error('[users:create:companies]', e.message); }
    // Grupet (Odoo): një listë ID-sh grupesh, p.sh. ["GRP-SAL-USER","GRP-INV-MGR"].
    const groupIds = Array.isArray(req.body.groups) ? req.body.groups.map((g) => String(g)) : [];
    if (r === 'ROLE-ADMIN' && !groupIds.includes('GRP-SET-ADMIN')) groupIds.push('GRP-SET-ADMIN');
    for (const gid of groupIds) {
      await p.query('INSERT INTO user_groups(user_id,group_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, gid]);
    }
    const groups = await groupsForUser(id);
    await audit(req.user.username, 'USER_CREATE', un + ' / ' + r + (groupIds.length ? ' / grupe=' + groupIds.join(',') : ''));
    res.json({ ok: true, user: { id, username: un, name: String(name || ''), role: r, active: true, email: em, rights: (rights && typeof rights === 'object') ? rights : null, groups } });
  } catch (e) {
    if (/duplicate|unique/i.test(String(e.message))) return res.status(409).json({ ok: false, error: 'Përdoruesi ekziston' });
    console.error('[users:create]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' });
  }
});
app.patch('/api/admin/users/:id', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const p = getPool();
    const cur = await p.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
    const u = cur.rows[0];
    if (!u) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
    const { name, role, active, password, rights, email } = req.body || {};
    if (password !== undefined && String(password).length < 8) return res.status(400).json({ ok: false, error: 'Fjalëkalimi min 8 karaktere' });
    if (email !== undefined && email && !String(email).includes('@')) return res.status(400).json({ ok: false, error: 'Email i pavlefshëm' });
    if (active === false && u.role === 'ROLE-ADMIN') {
      const c = await p.query("SELECT COUNT(*)::int AS c FROM users WHERE role='ROLE-ADMIN' AND active=TRUE AND id<>$1", [u.id]);
      if (c.rows[0].c === 0) return res.status(400).json({ ok: false, error: 'Nuk mund të çaktivizohet admini i fundit' });
    }
    const nu = {
      name: name !== undefined ? String(name) : u.name,
      role: role !== undefined ? String(role) : u.role,
      active: active !== undefined ? !!active : u.active,
      hash: password !== undefined ? hashPassword(password) : u.password_hash,
    };
    const rightsJson = rights === null ? null : (rights !== undefined ? JSON.stringify(rights) : (u.rights ? JSON.stringify(u.rights) : null));
    const nem = email !== undefined ? String(email).trim() : (u.email || '');
    await p.query('UPDATE users SET name=$1,role=$2,active=$3,password_hash=$4,rights=$5::jsonb,email=$6 WHERE id=$7', [nu.name, nu.role, nu.active, nu.hash, rightsJson, nem, u.id]);
    // Grupet (Odoo): nëse dërgohet `groups`, zëvendëson tërësisht anëtarësinë.
    if (Array.isArray(req.body.groups)) {
      let groupIds = req.body.groups.map((g) => String(g));
      if (nu.role === 'ROLE-ADMIN' && !groupIds.includes('GRP-SET-ADMIN')) groupIds.push('GRP-SET-ADMIN');
      await p.query('DELETE FROM user_groups WHERE user_id=$1', [u.id]);
      for (const gid of groupIds) {
        await p.query('INSERT INTO user_groups(user_id,group_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [u.id, gid]);
      }
    }
    if (password !== undefined || active === false) await p.query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
    const groups = await groupsForUser(u.id);
    await audit(req.user.username, 'USER_UPDATE', u.username);
    res.json({ ok: true, user: { id: u.id, username: u.username, name: nu.name, role: nu.role, active: nu.active, email: nem, rights: rights === null ? null : (rights !== undefined ? rights : (u.rights || null)), groups } });
  } catch (e) { console.error('[users:update]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.delete('/api/admin/users/:id', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const p = getPool();
    const cur = await p.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
    const u = cur.rows[0];
    if (!u) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
    if (req.user && req.user.id === u.id) return res.status(400).json({ ok: false, error: 'S\u2019mund ta fshini veten' });
    if (u.role === 'ROLE-ADMIN') {
      const c = await p.query("SELECT COUNT(*)::int AS c FROM users WHERE role='ROLE-ADMIN' AND active=TRUE AND id<>$1", [u.id]);
      if (c.rows[0].c === 0) return res.status(400).json({ ok: false, error: 'Nuk mund t\u00eb fshihet admini i fundit' });
    }
    await p.query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
    await p.query('DELETE FROM users WHERE id=$1', [u.id]);
    await audit(req.user.username, 'USER_DELETE', u.username);
    res.json({ ok: true, deleted: u.username });
  } catch (e) { console.error('[users:delete]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// ===== Qasja sipas moduleve (Odoo): modulet, grupet dhe anëtarësia ============
// Modulet (aplikacionet) — të dukshme për çdo user të autentikuar (për formularët),
// të administrueshme vetëm nga admini.
app.get('/api/access/modules', needDb, needAuth, async (req, res) => {
  try {
    const { rows } = await getPool().query('SELECT * FROM access_modules ORDER BY sequence, name');
    res.json({ ok: true, modules: rows });
  } catch (e) { console.error('[access:modules]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.get('/api/access/groups', needDb, needAuth, async (req, res) => {
  try {
    const { rows } = await getPool().query('SELECT * FROM access_groups ORDER BY module_id, full_name');
    res.json({ ok: true, groups: rows });
  } catch (e) { console.error('[access:groups]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// Grupet e një përdoruesi (me implikimet e zgjeruara) — admin ose vetja.
app.get('/api/access/users/:id/groups', needDb, needAuth, async (req, res) => {
  try {
    if (req.params.id !== req.user.id && !access.isSuperuser(req.user)) {
      return res.status(403).json({ ok: false, error: 'Nuk keni të drejtë për këtë veprim' });
    }
    const p = getPool();
    const cur = await p.query('SELECT id FROM users WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
    // Të drejtat per kompani: ?company=C2 kthen grupet e asaj kompanie (+ ato globale).
    const wanted = String((req.query && req.query.company) || '').trim();
    let company = null;
    if (wanted) {
      const a = await companies.assertCompanyAccess(req.user, wanted);
      if (!a.ok) return res.status(a.code || 403).json({ ok: false, error: a.error });
      company = a.id;
    }
    const groups = await groupsForUser(req.params.id, p, company);
    const modules = await access.stateModules(req.params.id, p, company);
    res.json({ ok: true, groups, modules, company });
  } catch (e) { console.error('[access:user-groups]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// Grupet e një moduli (për formularin e modulit) — vetëm admin.
app.get('/api/access/modules/:id/groups', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const { rows } = await getPool().query('SELECT * FROM access_groups WHERE module_id=$1 ORDER BY full_name', [req.params.id]);
    res.json({ ok: true, groups: rows });
  } catch (e) { console.error('[access:module-groups]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// Përditësim i grupeve të një përdoruesi (formulari "Qasja" te përdoruesi) — vetëm admin.
app.patch('/api/access/users/:id/groups', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const p = getPool();
    const cur = await p.query('SELECT id, username, role FROM users WHERE id=$1', [req.params.id]);
    const u = cur.rows[0];
    if (!u) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
    if (!Array.isArray(req.body.groups)) return res.status(400).json({ ok: false, error: 'Kërkohet lista `groups`' });
    let groupIds = req.body.groups.map((g) => String(g));
    if (u.role === 'ROLE-ADMIN' && !groupIds.includes('GRP-SET-ADMIN')) groupIds.push('GRP-SET-ADMIN');
    // Të drejtat per kompani: company (në trup ose në adresë) shkruan rreshtat e asaj
    // kompanie; pa company përditësohen vetëm rreshtat globalë (sjellja e vjetër).
    const wanted = String((req.body && req.body.company) || (req.query && req.query.company) || '').trim();
    let company = null;
    if (wanted) {
      const a = await companies.assertCompanyAccess(req.user, wanted);
      if (!a.ok) return res.status(a.code || 403).json({ ok: false, error: a.error });
      company = a.id;
    }
    if (company) {
      await p.query('DELETE FROM user_groups WHERE user_id=$1 AND company_id=$2', [u.id, company]);
      for (const gid of groupIds) {
        await p.query('INSERT INTO user_groups(user_id,group_id,company_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [u.id, gid, company]);
      }
    } else {
      await p.query('DELETE FROM user_groups WHERE user_id=$1 AND company_id IS NULL', [u.id]);
      for (const gid of groupIds) {
        await p.query('INSERT INTO user_groups(user_id,group_id,company_id) VALUES($1,$2,NULL) ON CONFLICT DO NOTHING', [u.id, gid]);
      }
    }
    const groups = await groupsForUser(u.id, p, company);
    const modules = await access.stateModules(u.id, p, company);
    await audit(req.user.username, 'ACCESS_UPDATE', u.username + ' / grupe=' + groupIds.join(',') + (company ? ' / kompania ' + company : ''), company);
    events.rightsChanged({ actor: req.user.username, username: u && u.username, company });
    res.json({ ok: true, user: u, groups, modules, company });
  } catch (e) { console.error('[access:user-groups]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// ===== Kompanitë (multi-company) — vetëm admin ==============================
// Lista e kompanive me numrin e përdoruesve dhe versionin e gjendjes.
app.get('/api/admin/companies', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const p = getPool();
    const list = await companies.listCompanies(p);
    const st = await p.query('SELECT id,version,updated_at FROM app_state');
    const us = await p.query('SELECT company_id, COUNT(*)::int AS c FROM user_companies GROUP BY company_id');
    const stBy = {}; for (const r of st.rows) stBy[r.id] = r;
    const usBy = {}; for (const r of us.rows) usBy[r.company_id] = r.c;
    res.json({
      ok: true,
      companies: list.map((c) => ({
        ...c,
        users: usBy[c.id] || 0,
        stateVersion: stBy[c.id] ? stBy[c.id].version : 0,
        stateUpdatedAt: stBy[c.id] ? stBy[c.id].updated_at : null,
        hasState: !!stBy[c.id],
      })),
      default: companies.DEFAULT_COMPANY_ID,
    });
  } catch (e) { console.error('[companies:list]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.post('/api/admin/companies', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (name.length < 2) return res.status(400).json({ ok: false, error: 'Emri i kompanisë min 2 karaktere' });
    let code = String(b.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 2) code = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 3) || 'CO';
    const p = getPool();
    let id = String(b.id || '').trim().toUpperCase();
    if (!id) {
      const { rows } = await p.query("SELECT id FROM companies WHERE id ~ '^C[0-9]+$' ORDER BY LENGTH(id), id");
      let n = 1; const used = new Set(rows.map((r) => r.id));
      while (used.has('C' + n)) n++;
      id = 'C' + n;
    }
    const vat = Number(b.vatRate); const cur = String(b.currency || 'ALL').toUpperCase().slice(0, 8);
    await p.query(
      `INSERT INTO companies(id,code,name,nipt,address,city,country,vat_rate,currency,active)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)`,
      [id, code, name, String(b.nipt || ''), String(b.address || ''), String(b.city || ''),
        String(b.country || 'AL'), Number.isFinite(vat) ? vat : 20, cur]);
    await audit(req.user.username, 'COMPANY_CREATE', id + ' / ' + code + ' — ' + name, id);
    const list = await companies.listCompanies(p);
    events.companiesChanged({ actor: req.user.username, company: id });
    res.json({ ok: true, company: list.find((c) => c.id === id) || null, companies: list });
  } catch (e) {
    if (String(e.message || '').includes('duplicate key')) return res.status(400).json({ ok: false, error: 'Kodi i kompanisë është i zënë' });
    console.error('[companies:create]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' });
  }
});

app.patch('/api/admin/companies/:id', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const p = getPool();
    const id = String(req.params.id || '').trim();
    const cur = await p.query('SELECT * FROM companies WHERE id=$1', [id]);
    if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'Kompania nuk u gjet' });
    const b = req.body || {};
    const sets = [], vals = [];
    const put = (col, v) => { vals.push(v); sets.push(col + '=$' + vals.length); };
    if (b.name !== undefined) put('name', String(b.name).trim());
    if (b.code !== undefined) put('code', String(b.code).trim().toUpperCase());
    if (b.nipt !== undefined) put('nipt', String(b.nipt));
    if (b.address !== undefined) put('address', String(b.address));
    if (b.city !== undefined) put('city', String(b.city));
    if (b.country !== undefined) put('country', String(b.country));
    if (b.vatRate !== undefined && Number.isFinite(+b.vatRate)) put('vat_rate', +b.vatRate);
    if (b.currency !== undefined) put('currency', String(b.currency).toUpperCase().slice(0, 8));
    if (b.active !== undefined) put('active', !!b.active);
    if (!sets.length) return res.status(400).json({ ok: false, error: 'Asnjë fushë për përditësim' });
    vals.push(id);
    await p.query('UPDATE companies SET ' + sets.join(', ') + ' WHERE id=$' + vals.length, vals);
    await audit(req.user.username, 'COMPANY_UPDATE', id + ' / ' + Object.keys(b).join(','), id);
    const list = await companies.listCompanies(p);
    events.companiesChanged({ actor: req.user.username, company: id });
    res.json({ ok: true, company: list.find((c) => c.id === id) || null, companies: list });
  } catch (e) {
    if (String(e.message || '').includes('duplicate key')) return res.status(400).json({ ok: false, error: 'Kodi i kompanisë është i zënë' });
    console.error('[companies:update]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' });
  }
});

// Anëtarësia e një përdoruesi (kush punon në cilat kompani + e parazgjedhura).
app.get('/api/admin/users/:id/companies', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const p = getPool();
    const u = await p.query('SELECT id,username,role FROM users WHERE id=$1', [req.params.id]);
    if (!u.rows.length) return res.status(404).json({ ok: false, error: 'Përdoruesi nuk u gjet' });
    const { rows } = await p.query('SELECT company_id,is_default FROM user_companies WHERE user_id=$1', [req.params.id]);
    res.json({ ok: true, user: u.rows[0], membership: rows.map((r) => ({ id: r.company_id, isDefault: !!r.is_default })) });
  } catch (e) { console.error('[users:companies]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.put('/api/admin/users/:id/companies', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const p = getPool();
    const u = await p.query('SELECT id,username,role FROM users WHERE id=$1', [req.params.id]);
    if (!u.rows.length) return res.status(404).json({ ok: false, error: 'Përdoruesi nuk u gjet' });
    const raw = (req.body || {}).companies;
    if (!Array.isArray(raw)) return res.status(400).json({ ok: false, error: 'Kërkohet lista `companies`' });
    const items = raw.map((c) => (typeof c === 'string' ? { id: c, isDefault: false } : { id: String(c && c.id || ''), isDefault: !!(c && (c.isDefault || c.is_default)) }))
      .filter((c) => c.id);
    if (!items.length) return res.status(400).json({ ok: false, error: 'Zgjidhni të paktën një kompani' });
    const known = await p.query('SELECT id FROM companies WHERE id = ANY($1::text[])', [items.map((c) => c.id)]);
    const okIds = new Set(known.rows.map((r) => r.id));
    const bad = items.filter((c) => !okIds.has(c.id));
    if (bad.length) return res.status(400).json({ ok: false, error: 'Kompani e panjohur: ' + bad.map((b) => b.id).join(', ') });
    const dft = (items.find((c) => c.isDefault) || items[0]).id;
    await p.query('DELETE FROM user_companies WHERE user_id=$1', [u.rows[0].id]);
    for (const c of items) {
      await p.query('INSERT INTO user_companies(user_id,company_id,is_default) VALUES($1,$2,$3) ON CONFLICT (user_id,company_id) DO UPDATE SET is_default=EXCLUDED.is_default',
        [u.rows[0].id, c.id, c.id === dft]);
    }
    await audit(req.user.username, 'COMPANY_MEMBERSHIP', u.rows[0].username + ' → ' + items.map((c) => c.id).join(',') + ' (default ' + dft + ')');
    const { rows } = await p.query('SELECT company_id,is_default FROM user_companies WHERE user_id=$1', [u.rows[0].id]);
    events.companiesChanged({ actor: req.user.username, membershipOf: u.rows[0].username });
    res.json({ ok: true, user: u.rows[0], membership: rows.map((r) => ({ id: r.company_id, isDefault: !!r.is_default })) });
  } catch (e) { console.error('[users:companies:put]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// Kontrata që pret frontend-i: POST /api/admin/wipe {password} → {ok:true}
// VINI RE: passwordi verifikohet ndaj adminit NË SERVER (ADMIN_PASSWORD).
// Për Reset të plotë (server + pajisje), ky password duhet të jetë i njëjtë
// me passwordin e adminit në aplikacion — ndryshe serveri refuzon dhe
// aplikacioni anulon edhe fshirjen lokale.
app.post('/api/admin/wipe', rateLimit(10, 15 * 60 * 1000), needDb, async (req, res) => {
  try {
    const { password } = req.body || {};
    const company = String((req.body || {}).company || '').trim() || companies.DEFAULT_COMPANY_ID;
    const p = getPool();
    if (company !== companies.DEFAULT_COMPANY_ID) {
      const c = await p.query('SELECT id FROM companies WHERE id=$1', [company]);
      if (!c.rows.length) return res.status(404).json({ ok: false, error: 'Kompania nuk u gjet' });
    }
    const { rows } = await p.query('SELECT * FROM users WHERE role=\'ROLE-ADMIN\' AND active=TRUE ORDER BY created_at LIMIT 5');
    const admin = rows.find((u) => verifyPassword(password || '', u.password_hash));
    if (!admin) return res.status(401).json({ ok: false, error: 'Password i gabuar' });
    await p.query('DELETE FROM app_state WHERE id=$1', [company]);
    await companies.setWipeMark(p, company);
    // Sjellja e vjetër për kompaninë e parazgjedhur: pastrimi total i sistemit i nxjerr jashtë sesionit
    // përdoruesit e tjerë. Pastrimi i një kompanie tjetër nuk i prek sesionet e kompanive të tjera.
    if (company === companies.DEFAULT_COMPANY_ID) await p.query('DELETE FROM sessions WHERE user_id <> $1', [admin.id]);
    await audit(admin.username, 'WIPE', 'Fshirje e kompanisë ' + company + ' (u ruajt admini)', company);
    const wipedAt = await companies.getWipeMark(p, company);
    events.wiped(company, wipedAt, admin.username);
    res.json({ ok: true, company, wipedAt });
  } catch (e) { console.error('[wipe]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// ===== Backup-et me datë në server (Postgres) — vetëm admin =================
// Çdo backup = kopje e app_state me datë/autor/version; mbahen N të fundit.
// Rikthimi krijon më parë një backup automatik të gjendjes aktuale (safety net).
const BACKUP_KEEP = +(process.env.BACKUP_KEEP || 14);
app.get('/api/backups', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const co = String(req.query.company || '').trim();
    const { rows } = co
      ? await getPool().query('SELECT id,taken_at,label,taken_by,state_version,size_bytes,company_id FROM backups WHERE COALESCE(company_id,$1)=$1 ORDER BY taken_at DESC, id DESC LIMIT 50', [co])
      : await getPool().query('SELECT id,taken_at,label,taken_by,state_version,size_bytes,company_id FROM backups ORDER BY taken_at DESC, id DESC LIMIT 50');
    res.json({ ok: true, backups: rows, keep: BACKUP_KEEP });
  } catch (e) { console.error('[backups:list]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});
app.post('/api/backups', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const p = getPool();
    const company = String((req.body || {}).company || '').trim() || companies.DEFAULT_COMPANY_ID;
    const cur = await p.query('SELECT data,version FROM app_state WHERE id=$1', [company]);
    if (!cur.rows.length) return res.status(409).json({ ok: false, error: 'Serveri nuk ka ende gjendje për backup' });
    const raw = JSON.stringify(cur.rows[0].data);
    if (raw.length > MAX_STATE_BYTES) return res.status(413).json({ ok: false, error: 'Gjendja tejkalon 25 MB' });
    const label = String((req.body || {}).label || '').slice(0, 120);
    const r = await p.query('INSERT INTO backups(label,taken_by,state_version,size_bytes,payload,company_id) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id,taken_at',
      [label, req.user.username, cur.rows[0].version || 0, raw.length, raw, company]);
    // Mbahen N backup-et e fundit PER KOMPANI (jo të përziera).
    await p.query('DELETE FROM backups WHERE COALESCE(company_id,$1)=$1 AND id NOT IN (SELECT id FROM backups WHERE COALESCE(company_id,$1)=$1 ORDER BY taken_at DESC, id DESC LIMIT ' + BACKUP_KEEP + ')', [company]);
    await audit(req.user.username, 'BACKUP_SERVER', 'id ' + r.rows[0].id + ' / kompania ' + company + (label ? ' / ' + label : ''), company);
    res.json({ ok: true, id: r.rows[0].id, company, takenAt: r.rows[0].taken_at });
  } catch (e) { console.error('[backups:create]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});
app.get('/api/backups/:id', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const { rows } = await getPool().query('SELECT id,taken_at,label,taken_by,state_version,size_bytes,payload,company_id FROM backups WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Backup-i nuk u gjet' });
    const b = rows[0];
    res.json({ ok: true, backup: { id: b.id, takenAt: b.taken_at, label: b.label, takenBy: b.taken_by, stateVersion: b.state_version, sizeBytes: b.size_bytes, company: b.company_id || companies.DEFAULT_COMPANY_ID, state: b.payload } });
  } catch (e) { console.error('[backups:get]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});
app.post('/api/backups/:id/restore', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const p = getPool();
    const src = await p.query('SELECT payload,company_id FROM backups WHERE id=$1', [req.params.id]);
    if (!src.rows.length) return res.status(404).json({ ok: false, error: 'Backup-i nuk u gjet' });
    const v = validateState(src.rows[0].payload);
    if (!v.ok) return res.status(400).json({ ok: false, error: 'Backup-i i zgjedhur është i pavlefshëm: ' + v.errors[0] });
    // Rikthimi nuk kalon dot nga një kompani në tjetrën (pastërti kontabël).
    const srcCompany = src.rows[0].company_id || companies.DEFAULT_COMPANY_ID;
    const target = String((req.body || {}).company || '').trim() || srcCompany;
    if (target !== srcCompany) {
      return res.status(400).json({ ok: false, error: 'Backup-i i kompanisë ' + srcCompany + ' nuk rikthehet mbi kompaninë ' + target });
    }
    const cur = await p.query('SELECT data,version FROM app_state WHERE id=$1', [target]);
    if (cur.rows.length) {
      const rawNow = JSON.stringify(cur.rows[0].data);
      await p.query("INSERT INTO backups(label,taken_by,state_version,size_bytes,payload,company_id) VALUES('auto-para-rikthimit',$1,$2,$3,$4::jsonb,$5)", [req.user.username, cur.rows[0].version || 0, rawNow.length, rawNow, target]);
    }
    const raw = JSON.stringify(src.rows[0].payload);
    const r = await p.query('INSERT INTO app_state(id,company_id,data,version,updated_at) VALUES($1,$1,$2::jsonb,1,NOW()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,version=app_state.version+1,updated_at=NOW() RETURNING version', [target, raw]);
    await p.query('DELETE FROM backups WHERE COALESCE(company_id,$1)=$1 AND id NOT IN (SELECT id FROM backups WHERE COALESCE(company_id,$1)=$1 ORDER BY taken_at DESC, id DESC LIMIT ' + BACKUP_KEEP + ')', [target]);
    await audit(req.user.username, 'RESTORE_SERVER', 'kompania ' + target + ' nga backup id ' + req.params.id + ' → version ' + r.rows[0].version, target);
    events.stateChanged(target, r.rows[0].version, req.user.username);
    res.json({ ok: true, company: target, version: r.rows[0].version });
  } catch (e) { console.error('[backups:restore]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});
app.delete('/api/backups/:id', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const r = await getPool().query('DELETE FROM backups WHERE id=$1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ ok: false, error: 'Backup-i nuk u gjet' });
    await audit(req.user.username, 'BACKUP_DELETE', 'id ' + req.params.id);
    res.json({ ok: true });
  } catch (e) { console.error('[backups:delete]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// ===== Ngjarje në kohë reale (SSE) ==========================================
// Pajisja hap një lidhje të vetme dhe merr njoftim të menjëhershëm kur ndryshon
// gjendja e kompanisë së saj, kur krijohet/ndryshohet një kompani ose kur
// ndryshojnë të drejtat. Token-i pranohet edhe si `?token=` sepse EventSource
// nuk lejon header-a. Lidhja mbahet gjallë me 'ping' çdo 25 s.
app.get('/api/events', needDb, async (req, res) => {
  const tok = String(req.query.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const user = await userFromToken(tok).catch(() => null);
  if (!user) return res.status(401).json({ ok: false, error: 'Sesioni ka skaduar — hyni përsëri' });
  let superuser = true, mine = [];
  try { const a = await access.loadAccessContext(user); superuser = a.superuser !== false; } catch (e) {}
  try { const c = await companies.contextFor(user); mine = (c.companies || []).filter((x) => x.active !== false).map((x) => x.id); } catch (e) {}
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  });
  res.write('retry: 2000\n\n');
  res.write('event: hello\ndata: ' + JSON.stringify({ ok: true, user: user.username, companies: mine, superuser, at: new Date().toISOString() }) + '\n\n');
  const client = { res, user, superuser, companies: mine, since: Date.now() };
  events.add(client);
  console.log('[events] + ' + user.username + ' (total ' + events.size() + ')');
  let closed = false;
  const close = () => { if (closed) return; closed = true; events.remove(client); try { res.end(); } catch (e) {} console.log('[events] - ' + user.username + ' (total ' + events.size() + ')'); };
  req.on('close', close);
  req.on('error', close);
  res.on('error', close);
});
events.startHeartbeat();

app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Endpoint i panjohur' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[fatal]', err.message);
  if (err.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'Kërkesa tejkalon 30 MB' });
  res.status(500).json({ ok: false, error: 'Gabim serveri' });
});

(async () => {
  try { if (await migrate()) await ensureAdmin(); }
  catch (e) { console.error('[boot] databaza dështoi:', e.message, '— vazhdohet pa DB.'); }
  app.listen(PORT, '0.0.0.0', () => console.log(`[biobes-api] live në portën ${PORT}`));
})();
