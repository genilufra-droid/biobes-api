// BioBes API (MVP) — auth + sinkronizim state + wipe. Aiven Postgres + Render.
const express = require('express');
const crypto = require('crypto');
const { getPool, dbOk } = require('./db');
const { migrate } = require('./migrate');
const { validateState } = require('./validateState');
const { ensureAdmin, loginUser, userFromToken, logoutToken, rateLimit, verifyPassword, hashPassword, groupsForUser } = require('./auth');
const access = require('./access');

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
      const a = await access.modelAccess(req.user.id, model);
      if (!access.checkAccess(a, action)) {
        return res.status(403).json({ ok: false, error: 'Nuk keni të drejtë për këtë veprim (' + model + ':' + action + ')' });
      }
      next();
    } catch (e) { console.error('[access] needAccess:', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
  };
}

async function audit(actor, action, detail) {
  try {
    await getPool().query('INSERT INTO audit_log(actor,action,detail) VALUES($1,$2,$3)', [actor || '', action, detail || '']);
  } catch (e) { console.error('[audit]', e.message); }
}

app.get('/api/health', async (req, res) => {
  res.json({ ok: true, db: await dbOk(), version: 1, time: new Date().toISOString() });
});

app.post('/api/auth/login', rateLimit(10, 15 * 60 * 1000), needDb, async (req, res) => {
  const { username, password } = req.body || {};
  let r;
  try { r = await loginUser(username, password); }
  catch (e) { console.error('[login]', e.message); return res.status(503).json({ ok: false, error: 'Databaza nuk përgjigjet' }); }
  if (!r) return res.status(401).json({ ok: false, error: 'Kredenciale të gabuara' });
  await audit(r.user.username, 'LOGIN', 'Hyrje në API');
  res.json({ ok: true, token: r.token, user: r.user, modules: r.modules });
});

app.post('/api/auth/logout', needAuth, async (req, res) => {
  await logoutToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  res.json({ ok: true });
});

app.get('/api/auth/me', needDb, needAuth, async (req, res) => {
  try {
    const groups = await groupsForUser(req.user.id);
    res.json({ ok: true, user: req.user, groups, modules: req.access.modules, superuser: req.access.superuser });
  } catch (e) { console.error('[auth:me]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.get('/api/state/version', needDb, needAuth, async (req, res) => {
  try {
    const { rows } = await getPool().query("SELECT version,updated_at FROM app_state WHERE id='main'");
    res.json({ ok: true, version: rows.length ? rows[0].version : 0, updatedAt: rows.length ? rows[0].updated_at : null });
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

app.get('/api/state', needDb, needAuth, async (req, res) => {
  try {
    const { rows } = await getPool().query('SELECT data,version,updated_at FROM app_state WHERE id=\'main\'');
    const wm = await getPool().query("SELECT value FROM meta WHERE key='wiped_at'");
    const wipedAt = wm.rows.length ? wm.rows[0].value : null;
    if (!rows.length) return res.json({ ok: true, state: null, version: 0, updatedAt: null, wipedAt, modules: req.access.modules });
    // Qasja sipas moduleve (Odoo): superuser/Administrator sheh gjithçka; të tjerët vetëm modulet e tyre.
    const state = access.applyStateModules(rows[0].data, req.access.modules);
    res.json({ ok: true, state, version: rows[0].version, updatedAt: rows[0].updated_at, wipedAt, modules: req.access.modules });
  } catch (e) { console.error('[state:get]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.put('/api/state', needDb, needAuth, async (req, res) => {
  try {
    const { state, baseVersion, wipeAck } = req.body || {};
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
      const cur = await p.query("SELECT data FROM app_state WHERE id='main'");
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

    const wrow = await p.query("SELECT value FROM meta WHERE key='wiped_at'");
    const wipedMark = wrow.rows.length ? wrow.rows[0].value : null;
    const clearWipeMark = async () => { try { await p.query("DELETE FROM meta WHERE key='wiped_at'"); } catch (e) {} };
    if (wipedMark && wipeAck !== wipedMark) {
      return res.status(409).json({ ok: false, error: 'Serveri u pastrua totalisht — pajisja duhet të pastrohet ose të rifillojë epokën', wiped: true, wipedAt: wipedMark });
    }
    if (baseVersion === undefined || baseVersion === null) {
      // Blind write (first push / legacy client): single-statement atomic increment.
      const r = await p.query(
        `INSERT INTO app_state(id,data,version,updated_at) VALUES('main',$1::jsonb,1,NOW())
         ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,version=app_state.version+1,updated_at=NOW() RETURNING version`,
        [raw]
      );
      const ver = r.rows[0].version;
      await audit(req.user.username, 'STATE_PUT', 'version ' + ver + ' (blind)' + (req.access.superuser ? '' : ' modules=' + (req.access.modules.allowedModules || []).join(',')));
      await clearWipeMark();
      return res.json({ ok: true, version: ver, updatedAt: new Date().toISOString() });
    }
    if (!Number.isFinite(+baseVersion)) {
      return res.status(400).json({ ok: false, error: 'baseVersion i pavlefshëm' });
    }
    // Atomic compare-and-swap: check + write in ONE statement, no lost-update race.
    const r = await p.query(
      `UPDATE app_state SET data=$1::jsonb,version=version+1,updated_at=NOW()
       WHERE id='main' AND version=$2 RETURNING version`,
      [raw, +baseVersion]
    );
    if (!r.rows.length) {
      const cur = await p.query(`SELECT version FROM app_state WHERE id='main'`);
      if (!cur.rows.length && +baseVersion === 0) {
        // Fresh DB: first guarded write creates the row (insert race -> 409 below).
        const ins = await p.query(
          `INSERT INTO app_state(id,data,version,updated_at) VALUES('main',$1::jsonb,1,NOW())
           ON CONFLICT(id) DO NOTHING RETURNING version`,
          [raw]
        );
        if (ins.rows.length) {
          await audit(req.user.username, 'STATE_PUT', 'version 1 (init)');
          await clearWipeMark();
          return res.json({ ok: true, version: 1, updatedAt: new Date().toISOString() });
        }
      }
      const cur2 = await p.query(`SELECT version FROM app_state WHERE id='main'`);
      const ver = cur2.rows.length ? cur2.rows[0].version : 0;
      return res.status(409).json({ ok: false, error: 'Konflikt versionesh — ringarko state-in', version: ver });
    }
    const ver = r.rows[0].version;
    await audit(req.user.username, 'STATE_PUT', 'version ' + ver + (req.access.superuser ? '' : ' modules=' + (req.access.modules.allowedModules || []).join(',')));
    await clearWipeMark();
    res.json({ ok: true, version: ver, updatedAt: new Date().toISOString() });
  } catch (e) { console.error('[state:put]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.get('/api/audit', needDb, needAuth, needAccess('audit', 'read'), async (req, res) => {
  try {
    const lim = Math.min(Math.max(+req.query.limit || 100, 1), 500);
    const { rows } = await getPool().query('SELECT id,at,actor,action,detail FROM audit_log ORDER BY id DESC LIMIT $1', [lim]);
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
    const groups = await groupsForUser(req.params.id);
    const modules = await access.stateModules(req.params.id, p);
    res.json({ ok: true, groups, modules });
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
    await p.query('DELETE FROM user_groups WHERE user_id=$1', [u.id]);
    for (const gid of groupIds) {
      await p.query('INSERT INTO user_groups(user_id,group_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [u.id, gid]);
    }
    const groups = await groupsForUser(u.id);
    const modules = await access.stateModules(u.id, p);
    await audit(req.user.username, 'ACCESS_UPDATE', u.username + ' / grupe=' + groupIds.join(','));
    res.json({ ok: true, user: u, groups, modules });
  } catch (e) { console.error('[access:user-groups]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// Kontrata që pret frontend-i: POST /api/admin/wipe {password} → {ok:true}
// VINI RE: passwordi verifikohet ndaj adminit NË SERVER (ADMIN_PASSWORD).
// Për Reset të plotë (server + pajisje), ky password duhet të jetë i njëjtë
// me passwordin e adminit në aplikacion — ndryshe serveri refuzon dhe
// aplikacioni anulon edhe fshirjen lokale.
app.post('/api/admin/wipe', rateLimit(10, 15 * 60 * 1000), needDb, async (req, res) => {
  try {
    const { password } = req.body || {};
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM users WHERE role=\'ROLE-ADMIN\' AND active=TRUE ORDER BY created_at LIMIT 5');
    const admin = rows.find((u) => verifyPassword(password || '', u.password_hash));
    if (!admin) return res.status(401).json({ ok: false, error: 'Password i gabuar' });
    await p.query('DELETE FROM app_state WHERE id=\'main\'');
    await p.query("INSERT INTO meta(key,value) VALUES('wiped_at', NOW()::text) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value");
    await p.query('DELETE FROM sessions WHERE user_id <> $1', [admin.id]);
    await audit(admin.username, 'WIPE', 'Fshirje totale nga aplikacioni (u ruajt admini)');
    const wrow2 = await p.query("SELECT value FROM meta WHERE key='wiped_at'");
    res.json({ ok: true, wipedAt: wrow2.rows.length ? wrow2.rows[0].value : null });
  } catch (e) { console.error('[wipe]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

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
