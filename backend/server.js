// BioBes API (MVP) — auth + sinkronizim state + wipe. Aiven Postgres + Render.
const express = require('express');
const crypto = require('crypto');
const { getPool, dbOk } = require('./db');
const { migrate } = require('./migrate');
const { validateState } = require('./validateState');
const { ensureAdmin, loginUser, userFromToken, logoutToken, rateLimit, verifyPassword, hashPassword } = require('./auth');

const app = express();
app.set('trust proxy', 1); // Render: IP reale e klientit për rate-limit
const PORT = process.env.PORT || 3000;
const MAX_STATE_BYTES = 25 * 1024 * 1024; // njëjtë me RESTORE_MAX_BYTES në frontend

// CORS minimal (MVP): origjina e frontend-it ose * nëse nuk është vendosur.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
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
  next();
}

function needAdminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'ROLE-ADMIN') return res.status(403).json({ ok: false, error: 'Kërkohet rol administratori' });
  next();
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
  res.json({ ok: true, token: r.token, user: r.user });
});

app.post('/api/auth/logout', needAuth, async (req, res) => {
  await logoutToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  res.json({ ok: true });
});

app.get('/api/auth/me', needAuth, (req, res) => res.json({ ok: true, user: req.user }));

app.get('/api/state', needDb, needAuth, async (req, res) => {
  try {
    const { rows } = await getPool().query('SELECT data,version,updated_at FROM app_state WHERE id=\'main\'');
    const wm = await getPool().query("SELECT value FROM meta WHERE key='wiped_at'");
    const wipedAt = wm.rows.length ? wm.rows[0].value : null;
    if (!rows.length) return res.json({ ok: true, state: null, version: 0, updatedAt: null, wipedAt });
    res.json({ ok: true, state: rows[0].data, version: rows[0].version, updatedAt: rows[0].updated_at, wipedAt });
  } catch (e) { console.error('[state:get]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.put('/api/state', needDb, needAuth, async (req, res) => {
  try {
    const { state, baseVersion, wipeAck } = req.body || {};
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return res.status(400).json({ ok: false, error: 'State i pavlefshëm' });
    }
    const vstate = validateState(state);
    if (!vstate.ok) return res.status(400).json({ ok: false, error: 'Serveri refuzoi ruajtjen: ' + vstate.errors[0], errors: vstate.errors });
    const raw = JSON.stringify(state);
    if (raw.length > MAX_STATE_BYTES) return res.status(413).json({ ok: false, error: 'State tejkalon 25 MB' });
    const p = getPool();
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
      await audit(req.user.username, 'STATE_PUT', 'version ' + ver + ' (blind)');
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
    await audit(req.user.username, 'STATE_PUT', 'version ' + ver);
    await clearWipeMark();
    res.json({ ok: true, version: ver, updatedAt: new Date().toISOString() });
  } catch (e) { console.error('[state:put]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.get('/api/audit', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const lim = Math.min(Math.max(+req.query.limit || 100, 1), 500);
    const { rows } = await getPool().query('SELECT id,at,actor,action,detail FROM audit_log ORDER BY id DESC LIMIT $1', [lim]);
    res.json({ ok: true, rows });
  } catch (e) { console.error('[audit]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// Administrim përdoruesish (vetëm admin).
app.get('/api/admin/users', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const { rows } = await getPool().query('SELECT id,username,name,role,active,created_at FROM users ORDER BY created_at');
    res.json({ ok: true, users: rows });
  } catch (e) { console.error('[users:list]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});
app.post('/api/admin/users', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const { username, password, name, role } = req.body || {};
    const un = String(username || '').trim();
    if (un.length < 3) return res.status(400).json({ ok: false, error: 'Përdoruesi min 3 karaktere' });
    if (!password || String(password).length < 8) return res.status(400).json({ ok: false, error: 'Fjalëkalimi min 8 karaktere' });
    const r = String(role || 'ROLE-USER');
    const id = 'USR-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    await getPool().query('INSERT INTO users(id,username,name,role,password_hash) VALUES($1,$2,$3,$4,$5)',
      [id, un, String(name || ''), r, hashPassword(password)]);
    await audit(req.user.username, 'USER_CREATE', un + ' / ' + r);
    res.json({ ok: true, user: { id, username: un, name: String(name || ''), role: r, active: true } });
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
    const { name, role, active, password } = req.body || {};
    if (password !== undefined && String(password).length < 8) return res.status(400).json({ ok: false, error: 'Fjalëkalimi min 8 karaktere' });
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
    await p.query('UPDATE users SET name=$1,role=$2,active=$3,password_hash=$4 WHERE id=$5', [nu.name, nu.role, nu.active, nu.hash, u.id]);
    if (password !== undefined || active === false) await p.query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
    await audit(req.user.username, 'USER_UPDATE', u.username);
    res.json({ ok: true, user: { id: u.id, username: u.username, name: nu.name, role: nu.role, active: nu.active } });
  } catch (e) { console.error('[users:update]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
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
