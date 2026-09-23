// BioBes API — auth + sinkronizim state + multi-company CRUD + realtime SSE.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Lexo .env nëse ekziston (pa varësi dotenv)
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (key && !process.env[key]) process.env[key] = val;
      }
    }
  }
} catch (_) {}

// Default për dev/test nëse mungon JWT_SECRET
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  process.env.JWT_SECRET = 'biobes-dev-jwt-secret-min-32-chars-long!!';
}
if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 16) {
  process.env.JWT_REFRESH_SECRET = 'biobes-dev-jwt-refresh-secret-min-32-chars!!';
}

const { getPool, dbOk } = require('./db');
const { migrate } = require('./migrate');
const { validateState } = require('./validateState');
const { ensureAdmin, loginUser, userFromToken, logoutToken, rateLimit, verifyPassword, hashPassword, groupsForUser } = require('./auth');
const access = require('./access');
const company = require('./company');
const rt = require('./server-realtime');

// Modulet e kit-it P1/P2/P3
const { signAccessToken, signRefreshToken, verify, hashToken, verifyPassword: tokenVerifyPassword, hashPassword: tokenHashPassword } = require('./lib/token');
const { withCompany, withSystem, requireCompanyMembership, companyFromRequest } = require('./lib/pgCompany');
const { nextNumber, reserveNumber } = require('./lib/sequences');
const { buildWorkbook, XLSX_MIME } = require('./lib/xlsx');
const { securityHeaders, corsMultiOrigin, jsonLimit, rateLimit: securityRateLimit } = require('./middleware/security');
const { runExclusive } = require('./lib/advisoryLock');

const app = express();
app.set('trust proxy', 1); // Render: IP reale e klientit për rate-limit
const PORT = process.env.PORT || 3000;
const MAX_STATE_BYTES = 25 * 1024 * 1024; // njëjtë me RESTORE_MAX_BYTES në frontend

function cleanupSSE(hash) { rt.removeClient(hash); }
const broadcastSSE = rt.broadcastSSE;

// P2 — Headerë sigurie + CORS multi-origin + rate limit (APPLY.md §4, hapi 7)
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(corsMultiOrigin);
app.use(jsonLimit());
app.use('/api', securityRateLimit({
  max: Number(process.env.RATE_LIMIT_MAX || 500),
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000),
}));

function needDb(req, res, next) {
  if (!getPool()) return res.status(503).json({ ok: false, error: 'Databaza nuk është e lidhur (DATABASE_URL mungon)' });
  next();
}

function checkPassword(plain, stored) {
  if (tokenVerifyPassword(plain, stored)) return true;
  if (verifyPassword(plain, stored)) return true;
  return false;
}

async function defaultCompanyFor(userId) {
  return withSystem(async (client) => {
    const r = await client.query(
      `SELECT company_id FROM company_users WHERE user_id = $1 AND is_default = TRUE LIMIT 1`,
      [userId]
    );
    if (r.rows.length) return r.rows[0].company_id;
    const r2 = await client.query(
      `SELECT company_id FROM company_users WHERE user_id = $1 ORDER BY company_id LIMIT 1`,
      [userId]
    );
    if (r2.rows.length) return r2.rows[0].company_id;
    const def = process.env.DEFAULT_COMPANY || 'C1';
    const r3 = await client.query(`SELECT id FROM companies WHERE id = $1 LIMIT 1`, [def]);
    if (r3.rows.length) return r3.rows[0].id;
    const r4 = await client.query(`SELECT id FROM companies ORDER BY id LIMIT 1`);
    if (r4.rows.length) return r4.rows[0].id;
    return null;
  });
}

// P1 — Middleware i autorizimit (APPLY.md §4, hapi 4)
async function auth(req, res, next) {
  const h = req.get('authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
  if (!tok) return res.status(401).json({ ok: false, error: 'Sesion i pavlefshëm — hyr përsëri' });
  try {
    const p = verify(tok, 'access');
    req.auth = { userId: p.sub, username: p.username, role: p.role,
                 companyId: p.companyId, isSuperadmin: !!p.isSuperadmin };
    req.user = { id: p.sub, username: p.username, role: p.role, is_superadmin: !!p.isSuperadmin, active: true };
    if (p.companyId && !req.companyId) {
      req.companyId = p.companyId;
      req.companyCtx = { companyId: p.companyId, userId: p.sub, isSuperadmin: !!p.isSuperadmin };
    }
    return next();
  } catch (e) {
    try {
      const u = await userFromToken(tok);
      if (u) {
        req.auth = { userId: u.id, username: u.username, role: u.role,
                     companyId: u.company_id || '', isSuperadmin: !!u.is_superadmin };
        req.user = u;
        if (u.company_id && !req.companyId) {
          req.companyId = u.company_id;
          req.companyCtx = { companyId: u.company_id, userId: u.id, isSuperadmin: !!u.is_superadmin };
        }
        return next();
      }
    } catch (_) {}
    const isExpired = e.name === 'TokenExpiredError';
    return res.status(401).json({ ok: false, error: 'Sesion i pavlefshëm — hyr përsëri', expired: isExpired });
  }
}

// Middleware autentikimi + ngarkimi i kontekstit të moduleve/kompanisë
async function needAuth(req, res, next) {
  const h = req.get('authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
  if (!tok) return res.status(401).json({ ok: false, error: 'Sesioni ka skaduar — hyni përsëri' });
  let user = null;
  let authPayload = null;
  try {
    authPayload = verify(tok, 'access');
    user = { id: authPayload.sub, username: authPayload.username, role: authPayload.role, is_superadmin: !!authPayload.isSuperadmin, active: true };
    req.auth = { userId: authPayload.sub, username: authPayload.username, role: authPayload.role, companyId: authPayload.companyId, isSuperadmin: !!authPayload.isSuperadmin };
  } catch (e) {
    user = await userFromToken(tok).catch(() => null);
    if (user) {
      req.auth = { userId: user.id, username: user.username, role: user.role, companyId: user.company_id || '', isSuperadmin: !!user.is_superadmin };
    }
  }
  if (!user) return res.status(401).json({ ok: false, error: 'Sesioni ka skaduar — hyni përsëri' });
  req.user = user;

  // Konteksti i qasjes (modulet + superuser) sipas skemës Odoo.
  try {
    req.access = await access.loadAccessContext(user);
  } catch (e) {
    console.error('[access] loadAccessContext:', e.message);
    const su = access.isSuperuser(user);
    req.access = { user, superuser: su, modules: su ? null : { full: false, allowedModules: [], allowedFields: [] }, allowedModules: [] };
  }
  // Ngarkojmë kontekstin e kompanisë (nëse ekziston).
  try {
    await company.loadCompanyContext(req, null, () => {});
    if (req.companyId) {
      req.companyCtx = {
        companyId: req.companyId,
        userId: req.user.id,
        isSuperadmin: !!(req.user.is_superadmin || req.user.role === 'ROLE-ADMIN'),
      };
    }
  } catch (e) { console.error('[company] loadCompanyContext:', e.message); }
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

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const isDb = await dbOk();
  let coCount = 0;
  if (isDb) {
    try {
      const cr = await getPool().query('SELECT count(*)::int as c FROM companies WHERE active=TRUE');
      coCount = cr.rows[0].c;
    } catch (_) {}
  }
  res.json({
    ok: true,
    db: isDb,
    version: 1,
    syncPolicy: access.SYNC_ALL_MODULES_FOR_SERVER_USERS ? 'all-modules' : 'per-group',
    defaultCompany: process.env.DEFAULT_COMPANY || 'C1',
    ...(coCount ? { companies: coCount } : {}),
    time: new Date().toISOString(),
  });
});

// P1 — Auth me JWT access (15m) + refresh token (7d) (APPLY.md §4, hapi 4)
app.post('/api/auth/login', needDb, async (req, res) => {
  const { username, password } = req.body || {};
  const un = String(username || '').trim();
  // login = para-autentikimit → kontekst SISTEM (përndryshe FORCE RLS nuk kthen asgjë)
  const user = await withSystem(async (client) => {
    const r = await client.query('SELECT * FROM users WHERE username = $1 AND active = TRUE', [un]);
    return r.rows[0];
  }).catch((e) => {
    console.error('[login]', e.message);
    return null;
  });

  if (!user || !checkPassword(password, user.password_hash)) {
    return res.status(401).json({ ok: false, error: 'Kredencialet nuk përputhen' });
  }

  const companyId = await defaultCompanyFor(user.id); // nga company_users.is_default
  const accessTok = signAccessToken(user, companyId);
  const jti = crypto.randomUUID();
  const refresh = signRefreshToken(user, jti);

  await withSystem((client) => client.query(
    `INSERT INTO refresh_tokens (id, token_hash, user_id, company_id, expires_at, user_agent, ip)
     VALUES ($1,$2,$3,$4, NOW() + ($5 || ' seconds')::interval, $6, $7)`,
    [jti, hashToken(refresh), user.id, companyId || null, process.env.JWT_REFRESH_TTL_SECONDS || 604800,
     req.get('user-agent') || '', req.ip || '']
  )).catch((e) => console.error('[refresh_tokens:insert]', e.message));

  // Përputhshmëri me sesionet ekzistuese në DB
  const th = hashToken(accessTok);
  await withSystem((client) => client.query(
    `INSERT INTO sessions(token_hash, user_id, expires_at)
     VALUES($1,$2, NOW() + ($3 || ' hours')::interval)`,
    [th, user.id, String(process.env.SESSION_TTL_HOURS || 24)]
  )).catch(() => {});

  let modules = null;
  try {
    const p = getPool();
    modules = await access.stateModules(user.id, p);
  } catch (_) {}

  await audit(user.username, 'LOGIN', 'Hyrje në API');
  res.json({
    ok: true,
    token: accessTok,
    refreshToken: refresh,
    expiresIn: Number(process.env.JWT_TTL_SECONDS || 900),
    user: {
      id: user.id,
      username: user.username,
      name: user.name || user.username,
      role: user.role,
      email: user.email || '',
      rights: user.rights || null,
      active: !!user.active,
      is_superuser: user.role === 'ROLE-ADMIN' || !!user.is_superadmin,
      is_superadmin: !!user.is_superadmin,
    },
    modules,
    companyId,
    isSuperadmin: !!user.is_superadmin,
  });
});

// P1 — POST /api/auth/refresh (APPLY.md §4, hapi 4)
app.post('/api/auth/refresh', needDb, async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ ok: false, error: 'Mungon refreshToken' });
  try {
    verify(refreshToken, 'refresh');
    const oldHash = hashToken(refreshToken);
    const result = await withSystem(async (client) => {
      const r = await client.query(
        `SELECT rt.*, u.username, u.role, u.is_superadmin, u.name, u.email, u.rights
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
         WHERE rt.token_hash = $1 AND rt.expires_at > NOW() AND rt.revoked_at IS NULL AND u.active = TRUE`,
        [oldHash]
      );
      if (!r.rows.length) return null;
      const rtRow = r.rows[0];
      await client.query('UPDATE refresh_tokens SET revoked_at = NOW(), last_used_at = NOW() WHERE token_hash = $1', [oldHash]);
      const user = { id: rtRow.user_id, username: rtRow.username, role: rtRow.role, is_superadmin: rtRow.is_superadmin };
      const companyId = rtRow.company_id || (await defaultCompanyFor(user.id));
      const newAccess = signAccessToken(user, companyId);
      const newJti = crypto.randomUUID();
      const newRefresh = signRefreshToken(user, newJti);
      await client.query(
        `INSERT INTO refresh_tokens (id, token_hash, user_id, company_id, expires_at, user_agent, ip)
         VALUES ($1,$2,$3,$4, NOW() + ($5 || ' seconds')::interval, $6, $7)`,
        [newJti, hashToken(newRefresh), user.id, companyId || null, process.env.JWT_REFRESH_TTL_SECONDS || 604800,
         req.get('user-agent') || '', req.ip || '']
      );
      try { await client.query('SELECT public.prune_refresh_tokens()'); } catch (_) {}
      return { token: newAccess, refreshToken: newRefresh, expiresIn: Number(process.env.JWT_TTL_SECONDS || 900), companyId };
    });
    if (!result) return res.status(401).json({ ok: false, error: 'Refresh token i pavlefshëm ose i skaduar' });
    res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'Refresh token i pavlefshëm' });
  }
});

app.post('/api/auth/logout', needAuth, async (req, res) => {
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  await logoutToken(tok);
  if (tok) {
    try {
      await withSystem((client) => client.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]));
    } catch (_) {}
  }
  res.json({ ok: true });
});

app.get('/api/auth/me', needDb, needAuth, async (req, res) => {
  try {
    const groups = await groupsForUser(req.user.id);
    const companies = await company.userCompanies(req.user.id);
    res.json({
      ok: true,
      user: req.user,
      groups,
      companies,
      activeCompanyId: req.companyId || (companies[0] && companies[0].id) || null,
      modules: req.access.modules,
      superuser: req.access.superuser,
      fetchPolicy: STATE_FETCH_POLICY,
    });
  } catch (e) { console.error('[auth:me]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// Kontroll PËR DOKUMENT (APPLY.md / F2.3): POST /api/state/patch
const PATCH_MAX_OPS = 500;
const PATCH_MAX_BYTES = 1024 * 1024;
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP || 14);

const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

function applyStateOps(base, ops, allowedFields) {
  const next = Object.assign({}, base || {});
  let changed = 0;
  for (const raw of ops) {
    const op = raw || {};
    const kind = String(op.kind || '');
    if (!kind) { const e = new Error('Dokumenti pa fushë (kind)'); e.code = 400; throw e; }
    if (allowedFields && !allowedFields.includes(kind)) { const e = new Error('Nuk keni të drejtë për fushën ' + kind); e.code = 403; throw e; }
    const hasPrev = Object.prototype.hasOwnProperty.call(op, 'prev');
    if (op.op === 'set') {
      if (hasPrev && !same(next[kind], op.prev)) { const e = new Error('Dokumenti u ndryshua nga një përdorues tjetër'); e.code = 409; e.kind = kind; e.current = next[kind]; throw e; }
      if (!same(next[kind], op.doc)) { next[kind] = op.doc; changed++; }
      continue;
    }
    if (!Array.isArray(next[kind])) {
      if (op.op === 'delete') continue;
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

app.get('/api/state/version', needDb, needAuth, async (req, res) => {
  try {
    const COMPANY = req.companyId || (req.query && req.query.company) || 'main';
    const { rows } = await getPool().query("SELECT version,updated_at FROM app_state WHERE id=$1", [COMPANY]);
    res.json({ ok: true, version: rows.length ? rows[0].version : 0, company: COMPANY, updatedAt: rows.length ? rows[0].updated_at : null });
  } catch (e) { console.error('[state:version]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// SSE endpoint
app.get('/api/events', needDb, async (req, res) => {
  const tok = (req.query.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '').toString();
  let user = null;
  try {
    const p = verify(tok, 'access');
    user = { id: p.sub, username: p.username, role: p.role, is_superadmin: !!p.isSuperadmin };
  } catch (_) {
    user = await userFromToken(tok).catch(() => null);
  }
  if (!user) return res.status(401).json({ ok: false, error: 'Sesioni ka skaduar' });
  let companies = [];
  let curVer = 1;
  try {
    const list = await company.userCompanies(user.id);
    companies = list.map((c) => c.id);
    if (user.role === 'ROLE-ADMIN') {
      const all = await getPool().query('SELECT id FROM companies');
      companies = all.rows.map((r) => r.id);
    }
    const vr = await getPool().query('SELECT MAX(version)::bigint AS v FROM company_sync');
    curVer = (vr.rows[0] && vr.rows[0].v) ? Number(vr.rows[0].v) : 1;
  } catch (e) {}
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const h = crypto.createHash('sha256').update(tok + ':' + Date.now()).digest('hex');
  rt.registerClient(h, { res, userId: user.id, username: user.username, companies });
  const ping = setInterval(() => {
    try { res.write(': ping ' + new Date().toISOString() + '\n\n'); } catch (e) {}
  }, 25000);
  res.write('event: connected\ndata: ' + JSON.stringify({ ok: true, userId: user.id, username: user.username, companies, version: curVer, time: new Date().toISOString() }) + '\n\n');
  req.on('close', () => { clearInterval(ping); cleanupSSE(h); });
  req.on('end', () => { clearInterval(ping); cleanupSSE(h); });
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
    await p.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id=$1', [req.user.id]).catch(() => {});
    await audit(req.user.username, 'PASSWORD_CHANGE', 'Fjalëkalimi u ndryshua');
    res.json({ ok: true });
  } catch (e) { console.error('[auth:password]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.post('/api/auth/forgot', securityRateLimit({ max: 5, windowMs: 15 * 60 * 1000 }), needDb, async (req, res) => {
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

app.post('/api/auth/reset', securityRateLimit({ max: 10, windowMs: 15 * 60 * 1000 }), needDb, async (req, res) => {
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
        await p.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id=$1', [u.id]).catch(() => {});
        await audit(u.username, 'PASSWORD_RESET', 'U rivendos me email');
        return res.json({ ok: true });
      }
      await p.query('UPDATE password_resets SET attempts=attempts+1 WHERE username=$1', [un]);
      bad = 'Kodi gabim';
    }
    return res.status(400).json({ ok: false, error: bad });
  } catch (e) { console.error('[auth:reset]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

const STATE_FETCH_POLICY = 'server-authoritative';

app.get('/api/state', needDb, needAuth, async (req, res) => {
  try {
    const COMPANY = req.companyId || (req.query && req.query.company) || 'main';
    const { rows } = await getPool().query('SELECT data,version,updated_at FROM app_state WHERE id=$1', [COMPANY]);
    const wm = await getPool().query("SELECT value FROM meta WHERE key='wiped_at'");
    const wipedAt = wm.rows.length ? wm.rows[0].value : null;
    if (!rows.length) return res.json({ ok: true, state: null, version: 0, updatedAt: null, wipedAt, company: COMPANY, modules: req.access.modules, fetchPolicy: STATE_FETCH_POLICY });
    const state = access.applyStateModules(rows[0].data, req.access.modules);
    res.json({ ok: true, state, version: rows[0].version, updatedAt: rows[0].updated_at, wipedAt, company: COMPANY, modules: req.access.modules, fetchPolicy: STATE_FETCH_POLICY });
  } catch (e) { console.error('[state:get]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.put('/api/state', needDb, needAuth, async (req, res) => {
  try {
    const COMPANY = req.companyId || (req.query && req.query.company) || 'main';
    const { state, baseVersion, wipeAck } = req.body || {};
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return res.status(400).json({ ok: false, error: 'State i pavlefshëm' });
    }
    const p = getPool();
    let stateToStore = state;
    let mergedFromServer = false;
    if (req.access && req.access.superuser === false) {
      const scoped = access.applyStateModules(state, req.access.modules);
      const onlyFields = (req.access.modules && req.access.modules.allowedFields) || [];
      const vscoped = validateState(scoped, { onlyFields });
      if (!vscoped.ok) return res.status(400).json({ ok: false, error: 'Serveri refuzoi ruajtjen: ' + vscoped.errors[0], errors: vscoped.errors });
      const cur = await p.query("SELECT data FROM app_state WHERE id=$1", [COMPANY]);
      const base = (cur.rows.length && cur.rows[0].data && typeof cur.rows[0].data === 'object' && !Array.isArray(cur.rows[0].data))
        ? cur.rows[0].data : {};
      stateToStore = Object.assign({}, base, scoped);
      mergedFromServer = true;
      const vfull = validateState(stateToStore);
      if (!vfull.ok) return res.status(400).json({ ok: false, error: 'Serveri refuzoi ruajtjen: ' + vfull.errors[0], errors: vfull.errors });
    } else {
      const cur = await p.query("SELECT data,version FROM app_state WHERE id=$1", [COMPANY]);
      const base = (cur.rows.length && cur.rows[0].data && typeof cur.rows[0].data === 'object' && !Array.isArray(cur.rows[0].data))
        ? cur.rows[0].data : {};
      const missingCritical = require('./validateState').CRITICAL_FIELDS.filter((k) => !Array.isArray(state[k]));
      if (missingCritical.length && cur.rows.length) {
        stateToStore = Object.assign({}, base, state);
        mergedFromServer = true;
      }
      const vstate = validateState(stateToStore, { requireAllKnown: false });
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
      const r = await p.query(
        `INSERT INTO app_state(id,data,version,updated_at) VALUES($1,$2::jsonb,1,NOW())
         ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,version=app_state.version+1,updated_at=NOW() RETURNING version`,
        [COMPANY, raw]
      );
      const ver = r.rows[0].version;
      await audit(req.user.username, 'STATE_PUT', 'company ' + COMPANY + ' version ' + ver + ' (blind)' + (req.access.superuser ? '' : ' modules=' + (req.access.modules.allowedModules || []).join(',')));
      await clearWipeMark();
      setImmediate(() => broadcastSSE('state-changed', { version: ver, actor: req.user.username, at: new Date().toISOString(), mergedFromServer, company: COMPANY }));
      return res.json({ ok: true, version: ver, company: COMPANY, updatedAt: new Date().toISOString(), mergedFromServer });
    }
    if (!Number.isFinite(+baseVersion)) {
      return res.status(400).json({ ok: false, error: 'baseVersion i pavlefshëm' });
    }
    const r = await p.query(
      `UPDATE app_state SET data=$1::jsonb,version=version+1,updated_at=NOW()
       WHERE id=$2 AND version=$3 RETURNING version`,
      [raw, COMPANY, +baseVersion]
    );
    if (!r.rows.length) {
      const cur = await p.query(`SELECT version FROM app_state WHERE id=$1`, [COMPANY]);
      if (!cur.rows.length && +baseVersion === 0) {
        const ins = await p.query(
          `INSERT INTO app_state(id,data,version,updated_at) VALUES($1,$2::jsonb,1,NOW())
           ON CONFLICT(id) DO NOTHING RETURNING version`,
          [COMPANY, raw]
        );
        if (ins.rows.length) {
          await audit(req.user.username, 'STATE_PUT', 'company ' + COMPANY + ' version 1 (init)');
          await clearWipeMark();
          setImmediate(() => broadcastSSE('state-changed', { version: 1, actor: req.user.username, at: new Date().toISOString(), company: COMPANY }));
          return res.json({ ok: true, version: 1, company: COMPANY, updatedAt: new Date().toISOString() });
        }
      }
      const cur2 = await p.query(`SELECT version FROM app_state WHERE id=$1`, [COMPANY]);
      const ver = cur2.rows.length ? cur2.rows[0].version : 0;
      return res.status(409).json({ ok: false, error: 'Konflikt versionesh — ringarko state-in', version: ver, company: COMPANY });
    }
    const ver = r.rows[0].version;
    await audit(req.user.username, 'STATE_PUT', 'company ' + COMPANY + ' version ' + ver + (req.access.superuser ? '' : ' modules=' + (req.access.modules.allowedModules || []).join(',')));
    await clearWipeMark();
    setImmediate(() => broadcastSSE('state-changed', { version: ver, actor: req.user.username, at: new Date().toISOString(), mergedFromServer, company: COMPANY }));
    res.json({ ok: true, version: ver, company: COMPANY, updatedAt: new Date().toISOString(), mergedFromServer });
  } catch (e) { console.error('[state:put]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.post('/api/state/patch', needDb, needAuth, async (req, res) => {
  try {
    const COMPANY = req.companyId || (req.query && req.query.company) || 'main';
    const ops = (req.body && req.body.ops) || null;
    if (!Array.isArray(ops) || !ops.length) return res.status(400).json({ ok: false, error: 'Kërkohet lista `ops`' });
    if (ops.length > PATCH_MAX_OPS) return res.status(413).json({ ok: false, error: 'Shumë ndryshime njëherësh (' + ops.length + ' > ' + PATCH_MAX_OPS + ')' });
    const rawOps = JSON.stringify(ops);
    if (rawOps.length > PATCH_MAX_BYTES) return res.status(413).json({ ok: false, error: 'Ndryshimet tejkalojnë 1 MB — përdoret ruajtja e plotë' });

    const p = getPool();
    const allowedFields = (req.access && req.access.superuser === false && req.access.modules) ? req.access.modules.allowedFields : null;

    const wrow = await p.query("SELECT value FROM meta WHERE key='wiped_at'");
    const wipedMark = wrow.rows.length ? wrow.rows[0].value : null;
    const wipeAck = req.body ? req.body.wipeAck : null;
    if (wipedMark && wipeAck !== wipedMark) {
      return res.status(409).json({ ok: false, error: 'Serveri u pastrua totalisht — pajisja duhet të pastrohet', wiped: true, wipedAt: wipedMark });
    }

    const client = await p.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query('SELECT data,version FROM app_state WHERE id=$1 FOR UPDATE', [COMPANY]);
      if (!cur.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: 'Serveri nuk ka gjendje — dërgohet e plotë', empty: true, version: 0, company: COMPANY });
      }
      const version = cur.rows[0].version;
      let out;
      try { out = applyStateOps(cur.rows[0].data, ops, allowedFields); }
      catch (e) {
        await client.query('ROLLBACK');
        return res.status(e.code || 400).json({
          ok: false, error: e.message, conflict: e.code === 409, kind: e.kind, id: e.id, current: e.current, version, company: COMPANY
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
      await audit(req.user.username, 'STATE_PATCH', 'company ' + COMPANY + ' version ' + ver + ' / ' + out.changed + ' ndryshime / ' + kinds);
      setImmediate(() => broadcastSSE('state-changed', { version: ver, actor: req.user.username, at: new Date().toISOString(), patch: true, company: COMPANY }));
      return res.json({ ok: true, version: ver, company: COMPANY, applied: out.changed, kinds });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_e) {}
      throw e;
    } finally {
      try { client.release(); } catch (e) {}
    }
  } catch (e) { console.error('[state:patch]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// Endpoint-e backups
app.get('/api/backups', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const COMPANY = req.companyId || (req.query && req.query.company) || 'main';
    const p = getPool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS backups(
        id BIGSERIAL PRIMARY KEY,
        taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        label TEXT NOT NULL DEFAULT '',
        taken_by TEXT NOT NULL DEFAULT '',
        company_id TEXT NOT NULL DEFAULT 'main',
        state_version INT NOT NULL DEFAULT 0,
        size_bytes INT NOT NULL DEFAULT 0,
        payload JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS backups_taken_at_idx ON backups(taken_at DESC);
    `);
    const { rows } = await p.query(
      'SELECT id,taken_at,label,taken_by,company_id,state_version,size_bytes FROM backups WHERE company_id=$1 OR company_id=\'main\' ORDER BY taken_at DESC, id DESC LIMIT 50',
      [COMPANY]
    );
    res.json({ ok: true, backups: rows, keep: BACKUP_KEEP, company: COMPANY });
  } catch (e) { console.error('[backups:list]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.post('/api/backups', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const COMPANY = req.companyId || (req.query && req.query.company) || 'main';
    const p = getPool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS backups(
        id BIGSERIAL PRIMARY KEY,
        taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        label TEXT NOT NULL DEFAULT '',
        taken_by TEXT NOT NULL DEFAULT '',
        company_id TEXT NOT NULL DEFAULT 'main',
        state_version INT NOT NULL DEFAULT 0,
        size_bytes INT NOT NULL DEFAULT 0,
        payload JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS backups_taken_at_idx ON backups(taken_at DESC);
    `);
    const cur = await p.query("SELECT data,version FROM app_state WHERE id=$1", [COMPANY]);
    if (!cur.rows.length) return res.status(409).json({ ok: false, error: 'Serveri nuk ka ende gjendje për backup' });
    const raw = JSON.stringify(cur.rows[0].data);
    if (raw.length > MAX_STATE_BYTES) return res.status(413).json({ ok: false, error: 'Gjendja tejkalon 25 MB' });
    const label = String((req.body || {}).label || '').slice(0, 120);
    const r = await p.query(
      'INSERT INTO backups(label,taken_by,company_id,state_version,size_bytes,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id,taken_at',
      [label, req.user.username, COMPANY, cur.rows[0].version || 0, raw.length, raw]
    );
    await p.query('DELETE FROM backups WHERE company_id=$1 AND id NOT IN (SELECT id FROM backups WHERE company_id=$1 ORDER BY taken_at DESC, id DESC LIMIT ' + BACKUP_KEEP + ')', [COMPANY]);
    await audit(req.user.username, 'BACKUP_SERVER', 'id ' + r.rows[0].id + (label ? ' / ' + label : '') + ' company ' + COMPANY);
    res.json({ ok: true, id: r.rows[0].id, takenAt: r.rows[0].taken_at, company: COMPANY });
  } catch (e) { console.error('[backups:create]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.get('/api/backups/:id', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const { rows } = await getPool().query('SELECT id,taken_at,label,taken_by,company_id,state_version,size_bytes,payload FROM backups WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Backup-i nuk u gjet' });
    const b = rows[0];
    res.json({ ok: true, backup: { id: b.id, takenAt: b.taken_at, label: b.label, takenBy: b.taken_by, companyId: b.company_id, stateVersion: b.state_version, sizeBytes: b.size_bytes, state: b.payload } });
  } catch (e) { console.error('[backups:get]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.post('/api/backups/:id/restore', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const p = getPool();
    const src = await p.query('SELECT payload, company_id FROM backups WHERE id=$1', [req.params.id]);
    if (!src.rows.length) return res.status(404).json({ ok: false, error: 'Backup-i nuk u gjet' });
    const COMPANY = req.companyId || (req.query && req.query.company) || src.rows[0].company_id || 'main';
    const v = validateState(src.rows[0].payload);
    if (!v.ok) return res.status(400).json({ ok: false, error: 'Backup-i i zgjedhur është i pavlefshëm: ' + v.errors[0] });
    const cur = await p.query("SELECT data,version FROM app_state WHERE id=$1", [COMPANY]);
    if (cur.rows.length) {
      const rawNow = JSON.stringify(cur.rows[0].data);
      await p.query(
        "INSERT INTO backups(label,taken_by,company_id,state_version,size_bytes,payload) VALUES('auto-para-rikthimit',$1,$2,$3,$4,$5::jsonb)",
        [req.user.username, COMPANY, cur.rows[0].version || 0, rawNow.length, rawNow]
      );
    }
    const raw = JSON.stringify(src.rows[0].payload);
    const r = await p.query(
      "INSERT INTO app_state(id,data,version,updated_at) VALUES($1,$2::jsonb,1,NOW()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,version=app_state.version+1,updated_at=NOW() RETURNING version",
      [COMPANY, raw]
    );
    await p.query('DELETE FROM backups WHERE company_id=$1 AND id NOT IN (SELECT id FROM backups WHERE company_id=$1 ORDER BY taken_at DESC, id DESC LIMIT ' + BACKUP_KEEP + ')', [COMPANY]);
    await audit(req.user.username, 'RESTORE_SERVER', 'nga backup id ' + req.params.id + ' → version ' + r.rows[0].version + ' company ' + COMPANY);
    setImmediate(() => broadcastSSE('state-changed', { version: r.rows[0].version, actor: req.user.username, at: new Date().toISOString(), company: COMPANY }));
    res.json({ ok: true, version: r.rows[0].version, company: COMPANY });
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
    if (Array.isArray(req.body.groups)) {
      let groupIds = req.body.groups.map((g) => String(g));
      if (nu.role === 'ROLE-ADMIN' && !groupIds.includes('GRP-SET-ADMIN')) groupIds.push('GRP-SET-ADMIN');
      await p.query('DELETE FROM user_groups WHERE user_id=$1', [u.id]);
      for (const gid of groupIds) {
        await p.query('INSERT INTO user_groups(user_id,group_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [u.id, gid]);
      }
    }
    if (password !== undefined || active === false) {
      await p.query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
      await p.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id=$1', [u.id]).catch(() => {});
    }
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
    await p.query('DELETE FROM refresh_tokens WHERE user_id=$1', [u.id]).catch(() => {});
    await p.query('DELETE FROM users WHERE id=$1', [u.id]);
    await audit(req.user.username, 'USER_DELETE', u.username);
    res.json({ ok: true, deleted: u.username });
  } catch (e) { console.error('[users:delete]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// Qasja sipas moduleve (Odoo)
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

app.get('/api/access/modules/:id/groups', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const { rows } = await getPool().query('SELECT * FROM access_groups WHERE module_id=$1 ORDER BY full_name', [req.params.id]);
    res.json({ ok: true, groups: rows });
  } catch (e) { console.error('[access:module-groups]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

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

app.post('/api/admin/wipe', securityRateLimit({ max: 10, windowMs: 15 * 60 * 1000 }), needDb, async (req, res) => {
  try {
    const { password } = req.body || {};
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM users WHERE role=\'ROLE-ADMIN\' AND active=TRUE ORDER BY created_at LIMIT 5');
    const admin = rows.find((u) => checkPassword(password || '', u.password_hash));
    if (!admin) return res.status(401).json({ ok: false, error: 'Password i gabuar' });
    await p.query('DELETE FROM app_state WHERE id=\'main\'');
    await p.query("INSERT INTO meta(key,value) VALUES('wiped_at', NOW()::text) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value");
    await p.query('DELETE FROM sessions WHERE user_id <> $1', [admin.id]);
    await p.query('DELETE FROM refresh_tokens WHERE user_id <> $1', [admin.id]).catch(() => {});
    await audit(admin.username, 'WIPE', 'Fshirje totale nga aplikacioni (u ruajt admini)');
    const wrow2 = await p.query("SELECT value FROM meta WHERE key='wiped_at'");
    const wipedAtVal = wrow2.rows.length ? wrow2.rows[0].value : null;
    setImmediate(() => broadcastSSE('wipe', { wipedAt: wipedAtVal, actor: admin.username, at: new Date().toISOString() }));
    res.json({ ok: true, wipedAt: wipedAtVal, fetchPolicy: STATE_FETCH_POLICY });
  } catch (e) { console.error('[wipe]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// ===== MULTI-COMPANY CRUD ==========================================

app.get('/api/companies', needDb, needAuth, async (req, res) => {
  try {
    if (req.user && (req.user.is_superadmin || req.user.role === 'ROLE-ADMIN')) {
      const all = await getPool().query('SELECT id, name, tax_id, currency, active FROM companies ORDER BY name ASC');
      return res.json({ ok: true, companies: all.rows });
    }
    const list = await company.userCompanies(req.user.id);
    res.json({ ok: true, companies: list });
  } catch (e) { console.error('[companies]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.post('/api/companies', needDb, needAuth, needAdminOnly, async (req, res) => {
  try {
    const { name, tax_id, address, city, phone, email, currency, owner_id } = req.body || {};
    if (!name || String(name).trim().length < 2) return res.status(400).json({ ok: false, error: 'Emri i kompanisë kërkohet (min 2 shkronja)' });
    const p = getPool();
    const id = 'CO-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    await p.query(
      `INSERT INTO companies(id,name,tax_id,address,city,phone,email,currency)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, String(name).trim(), String(tax_id||''), String(address||''), String(city||''),
       String(phone||''), String(email||''), String(currency||'ALL')]
    );
    const ownerId = owner_id || req.user.id;
    await p.query(
      `INSERT INTO company_users(company_id,user_id,role_in_company,is_default)
       VALUES($1,$2,'owner',TRUE) ON CONFLICT DO NOTHING`,
      [id, ownerId]
    );
    await p.query(
      `INSERT INTO company_sync(company_id,version) VALUES($1,1) ON CONFLICT DO NOTHING`,
      [id]
    );
    await audit(req.user.username, 'COMPANY_CREATE', id + ' / ' + name);
    res.status(201).json({ ok: true, company: { id, name: String(name).trim(), currency: currency || 'ALL' } });
  } catch (e) { console.error('[companies:create]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.patch('/api/companies/:id', needDb, needAuth, company.requireCompany, async (req, res) => {
  try {
    if (req.params.id !== req.companyId) return res.status(403).json({ ok: false, error: 'Nuk keni qasje në këtë kompani' });
    if (!['owner', 'admin'].includes(req.companyRole) && req.user.role !== 'ROLE-ADMIN' && !req.user.is_superadmin)
      return res.status(403).json({ ok: false, error: 'Nuk keni të drejtë për ndryshim profili' });
    const p = getPool();
    const fields = ['name','tax_id','address','city','phone','email','currency'];
    const sets = [], vals = [req.params.id];
    let i = 2;
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(f + '=$' + (i++)); vals.push(String(req.body[f] || '')); }
    }
    if (req.body.settings && typeof req.body.settings === 'object') {
      sets.push('settings=$' + (i++)); vals.push(JSON.stringify(req.body.settings));
    }
    sets.push('updated_at=NOW()');
    if (sets.length === 1) return res.status(400).json({ ok: false, error: 'Asnjë fushë për ndryshim' });
    const { rows } = await p.query(`UPDATE companies SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Kompania nuk ekziston' });
    await company.bumpVersion(req.params.id, req.user.username);
    res.json({ ok: true, company: rows[0] });
  } catch (e) { console.error('[companies:patch]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

app.post('/api/companies/:id/select', needDb, needAuth, async (req, res) => {
  try {
    const p = getPool();
    const check = await p.query('SELECT 1 FROM company_users WHERE company_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!check.rows.length && req.user.role !== 'ROLE-ADMIN' && !req.user.is_superadmin)
      return res.status(403).json({ ok: false, error: 'Nuk keni qasje në këtë kompani' });
    await p.query('UPDATE company_users SET is_default = (company_id=$1) WHERE user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true, selectedCompanyId: req.params.id });
  } catch (e) { console.error('[companies:select]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// P2 — Çdo rrugë biznesi → kontekst kompanie (APPLY.md §4, hapi 5)
app.get('/api/products', needDb, auth, requireCompanyMembership(), async (req, res) => {
  try {
    const rows = await withCompany(req.companyCtx, (client) =>
      client.query('SELECT * FROM products WHERE company_id = $1 ORDER BY code', [req.companyId]).then((r) => r.rows)
    );
    res.json({ ok: true, products: rows, rows: rows, total: rows.length, company: req.companyId });
  } catch (e) {
    console.error('[products:get]', e.message);
    res.status(500).json({ ok: false, error: 'Gabim serveri' });
  }
});

// P2 — Numërimi i dokumenteve me FOR UPDATE dhe kontratë 409 (APPLY.md §4, hapi 6)
app.post('/api/sales-invoices', needDb, auth, requireCompanyMembership(), async (req, res) => {
  try {
    const out = await withCompany(req.companyCtx, async (client) => {
      const wanted = req.body.number; // nëse pajisja e ka zgjedhur vetë
      let number;
      if (wanted) {
        const r = await reserveNumber(client, req.companyId, 'sales_invoice', wanted, { userId: req.auth.userId });
        if (!r.ok && r.conflict) {
          const err = new Error('Numri është i zënë');
          err.status = 409; err.conflict = 'number'; err.number = r.number; err.nextNumber = r.nextNumber;
          throw err;
        }
        number = r.number;
      } else {
        number = await nextNumber(client, req.companyId, 'sales_invoice', { userId: req.auth.userId });
      }
      const ins = await client.query(
        `INSERT INTO sales_invoices (company_id, id, number, customer_id, total, status, items, meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.companyId, req.body.id || crypto.randomUUID(), number, req.body.customerId || req.body.customer_id || '',
         req.body.total || 0, req.body.status || 'draft', JSON.stringify(req.body.items || []),
         JSON.stringify(req.body.meta || {})]
      );
      return ins.rows[0];
    });
    await company.bumpVersion(req.companyId, req.user && req.user.username);
    res.status(201).json({ ok: true, invoice: out, row: out, number: out.number });
  } catch (e) {
    if (e.status === 409 && e.conflict === 'number')
      return res.status(409).json({ ok: false, conflict: 'number', number: e.number, nextNumber: e.nextNumber,
                                    error: 'Numri është i zënë — aplikacioni do të marrë numrin tjetër' });
    if (e.status) return res.status(e.status).json({ ok: false, error: e.message });
    console.error('[sales-invoices:create]', e);
    res.status(500).json({ ok: false, error: 'Gabim gjatë ruajtjes' });
  }
});

app.post('/api/purchase-invoices', needDb, auth, requireCompanyMembership(), async (req, res) => {
  try {
    const out = await withCompany(req.companyCtx, async (client) => {
      const wanted = req.body.number;
      let number;
      if (wanted) {
        const r = await reserveNumber(client, req.companyId, 'purchase_invoice', wanted, { userId: req.auth.userId });
        if (!r.ok && r.conflict) {
          const err = new Error('Numri është i zënë');
          err.status = 409; err.conflict = 'number'; err.number = r.number; err.nextNumber = r.nextNumber;
          throw err;
        }
        number = r.number;
      } else {
        number = await nextNumber(client, req.companyId, 'purchase_invoice', { userId: req.auth.userId });
      }
      const ins = await client.query(
        `INSERT INTO purchase_invoices (company_id, id, number, supplier_id, total, status, items, meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.companyId, req.body.id || crypto.randomUUID(), number, req.body.supplierId || req.body.supplier_id || '',
         req.body.total || 0, req.body.status || 'draft', JSON.stringify(req.body.items || []),
         JSON.stringify(req.body.meta || {})]
      );
      return ins.rows[0];
    });
    await company.bumpVersion(req.companyId, req.user && req.user.username);
    res.status(201).json({ ok: true, invoice: out, row: out, number: out.number });
  } catch (e) {
    if (e.status === 409 && e.conflict === 'number')
      return res.status(409).json({ ok: false, conflict: 'number', number: e.number, nextNumber: e.nextNumber,
                                    error: 'Numri është i zënë — aplikacioni do të marrë numrin tjetër' });
    if (e.status) return res.status(e.status).json({ ok: false, error: e.message });
    console.error('[purchase-invoices:create]', e);
    res.status(500).json({ ok: false, error: 'Gabim gjatë ruajtjes' });
  }
});

// Montimi i CRUD-it për entitetet e biznesit
function mountCrud(pathStr, table, opts) {
  const c = company.buildCrud(table, opts);
  const r = express.Router();
  r.use(company.requireCompany);
  r.get('/', c.list);
  r.get('/:id', c.get);
  r.post('/', c.create);
  r.patch('/:id', c.update);
  r.delete('/:id', c.remove);
  app.use('/api/' + pathStr, needDb, needAuth, r);
}

mountCrud('products', 'products', { searchColumns: ['name','code'], jsonColumns: ['meta'] });
mountCrud('suppliers', 'suppliers', { searchColumns: ['name','code'], jsonColumns: ['meta'] });
mountCrud('customers', 'customers', { searchColumns: ['name','code'], jsonColumns: ['meta'] });
mountCrud('warehouses', 'warehouses', { searchColumns: ['name','code'], jsonColumns: ['meta'] });
mountCrud('lots', 'lots', { defaultSort: 'created_at DESC', searchColumns: ['lot_number','product_id'], jsonColumns: ['meta'] });
mountCrud('weighings', 'weighings', { defaultSort: 'weighed_at DESC', searchColumns: ['product_id'], jsonColumns: ['meta'] });
mountCrud('payments', 'payments', { defaultSort: 'paid_at DESC', jsonColumns: ['meta'] });
mountCrud('customer-payments', 'customer_payments', { defaultSort: 'paid_at DESC', jsonColumns: ['meta'] });
mountCrud('sales-invoices', 'sales_invoices', { defaultSort: 'issued_at DESC', searchColumns: ['number'], jsonColumns: ['items','meta'] });
mountCrud('purchase-invoices', 'purchase_invoices', { defaultSort: 'issued_at DESC', searchColumns: ['number'], jsonColumns: ['items','meta'] });

// Version i kompanisë (për polling të shpejtë, krahas SSE).
app.get('/api/sync/version', needDb, needAuth, company.requireCompany, async (req, res) => {
  try {
    const { rows } = await getPool().query('SELECT version, updated_at FROM company_sync WHERE company_id=$1', [req.companyId]);
    res.json({ ok: true, companyId: req.companyId, version: rows.length ? rows[0].version : 1, updatedAt: rows.length ? rows[0].updated_at : null });
  } catch (e) { console.error('[sync:version]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});

// Wipe për një kompani të vetme (APPLY.md §4, hapi 10)
const handleCompanyWipe = async (req, res) => {
  try {
    const cid = req.params.id;
    const p = getPool();
    const c = await p.query('SELECT id FROM companies WHERE id=$1', [cid]);
    if (!c.rows.length) return res.status(404).json({ ok: false, error: 'Kompania nuk ekziston' });
    const { password } = req.body || {};
    const admins = await p.query("SELECT * FROM users WHERE role='ROLE-ADMIN' AND active=TRUE LIMIT 5");
    const admin = admins.rows.find((u) => checkPassword(password || '', u.password_hash));
    if (!admin) return res.status(401).json({ ok: false, error: 'Password i gabuar' });

    // Fshi të dhënat e biznesit me withCompany për të respektuar RLS
    await withCompany({ companyId: cid, userId: admin.id, isSuperadmin: true }, async (client) => {
      for (const t of ['products','suppliers','customers','warehouses','lots','weighings',
                       'payments','customer_payments','sales_invoices','purchase_invoices']) {
        await client.query(`DELETE FROM ${t} WHERE company_id=$1`, [cid]);
      }
    });

    await p.query('DELETE FROM app_state WHERE id=$1', [cid]);
    await p.query(`INSERT INTO company_wipe_epoch(company_id,wiped_at,wiped_by)
                   VALUES($1,NOW(),$2)
                   ON CONFLICT(company_id) DO UPDATE SET wiped_at=NOW(), wiped_by=$2`, [cid, admin.username]);
    await p.query(`UPDATE company_sync SET version=version+1, updated_at=NOW() WHERE company_id=$1`, [cid]);
    await audit(admin.username, 'COMPANY_WIPE', cid);
    rt.broadcastCompanyEvent(cid, 'company-wiped', { companyId: cid, at: new Date().toISOString(), actor: admin.username });
    res.json({ ok: true, companyId: cid, wipedAt: new Date().toISOString() });
  } catch (e) { console.error('[company:wipe]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
};

app.post('/api/admin/company/:id/wipe', needDb, needAuth, needAdminOnly, handleCompanyWipe);
app.post('/api/companies/:id/wipe', needDb, needAuth, needAdminOnly, handleCompanyWipe);

// P3 — GET /api/manual (dhe /:moduleId) në shqip (APPLY.md §4, hapi 8)
require('./routes/manual').register(app, { middleware: [] });

// P3 — GET /api/export/xlsx (APPLY.md §4, hapi 9)
const sum = (rs, k) => rs.reduce((a, r) => a + (Number(r[k]) || 0), 0);

const MODULE_COLUMNS = {
  customerReturns: {
    title: 'Kthimet e klientëve',
    sheetName: 'Kthimet',
    sql: `SELECT r.number, r.returned_at AS date, c.name AS customer, r.kg, r.total
            FROM customer_returns r LEFT JOIN customers c ON c.company_id = r.company_id AND c.id = r.customer_id
           ORDER BY r.returned_at DESC, r.number`,
    columns: [
      { key: 'number', title: 'Numri', width: 16 },
      { key: 'date', title: 'Data', type: 'date', width: 12 },
      { key: 'customer', title: 'Klienti', width: 28 },
      { key: 'kg', title: 'Kg', type: 'kg', width: 10 },
      { key: 'total', title: 'Shuma (ALL)', type: 'money', width: 14 },
    ],
  },
  sales: {
    title: 'Faturat e shitjes',
    sheetName: 'Shitjet',
    sql: `SELECT s.number, s.issued_at AS date, c.name AS customer, s.total, s.status
            FROM sales_invoices s LEFT JOIN customers c ON c.company_id = s.company_id AND c.id = s.customer_id
           ORDER BY s.issued_at DESC, s.number`,
    columns: [
      { key: 'number', title: 'Numri', width: 16 },
      { key: 'date', title: 'Data', type: 'date', width: 12 },
      { key: 'customer', title: 'Klienti', width: 28 },
      { key: 'total', title: 'Shuma (ALL)', type: 'money', width: 14 },
      { key: 'status', title: 'Statusi', width: 12 },
    ],
  },
  purchases: {
    title: 'Faturat e blerjes',
    sheetName: 'Blerjet',
    sql: `SELECT p.number, p.issued_at AS date, s.name AS supplier, p.total, p.status
            FROM purchase_invoices p LEFT JOIN suppliers s ON s.company_id = p.company_id AND s.id = p.supplier_id
           ORDER BY p.issued_at DESC, p.number`,
    columns: [
      { key: 'number', title: 'Numri', width: 16 },
      { key: 'date', title: 'Data', type: 'date', width: 12 },
      { key: 'supplier', title: 'Furnitori', width: 28 },
      { key: 'total', title: 'Shuma (ALL)', type: 'money', width: 14 },
      { key: 'status', title: 'Statusi', width: 12 },
    ],
  },
  weighings: {
    title: 'Peshimet',
    sheetName: 'Peshimet',
    sql: `SELECT w.number, w.weighed_at AS date, p.name AS product, w.net_kg AS kg, w.total
            FROM weighings w LEFT JOIN products p ON p.company_id = w.company_id AND p.id = w.product_id
           ORDER BY w.weighed_at DESC, w.number`,
    columns: [
      { key: 'number', title: 'Numri', width: 16 },
      { key: 'date', title: 'Data', type: 'date', width: 12 },
      { key: 'product', title: 'Produkti', width: 28 },
      { key: 'kg', title: 'Kg', type: 'kg', width: 10 },
      { key: 'total', title: 'Shuma (ALL)', type: 'money', width: 14 },
    ],
  },
  products: {
    title: 'Produktet',
    sheetName: 'Produktet',
    sql: `SELECT code, name, unit, price, balance FROM products ORDER BY code`,
    columns: [
      { key: 'code', title: 'Kodi', width: 14 },
      { key: 'name', title: 'Emërtimi', width: 30 },
      { key: 'unit', title: 'Njësia', width: 10 },
      { key: 'balance', title: 'Gjendja (Kg)', type: 'kg', width: 14 },
      { key: 'price', title: 'Çmimi', type: 'money', width: 14 },
    ],
  },
};

app.get('/api/export/xlsx', needDb, auth, requireCompanyMembership(), async (req, res) => {
  const modKey = String(req.query.module || '');
  const mod = MODULE_COLUMNS[modKey];
  if (!mod) return res.status(404).json({ ok: false, error: 'Modul i panjohur për eksport' });
  try {
    const rows = await withCompany(req.companyCtx, async (c) => {
      if (modKey === 'customerReturns') {
        const hasTbl = await c.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customer_returns'").then((r) => r.rowCount > 0).catch(() => false);
        if (!hasTbl) {
          return c.query(
            `SELECT w.number, w.weighed_at AS date, c.name AS customer, w.net_kg AS kg, w.total
             FROM weighings w LEFT JOIN customers c ON c.company_id = w.company_id AND c.id = w.customer_id
             ORDER BY w.weighed_at DESC, w.number`
          ).then((r) => r.rows).catch(() => []);
        }
      }
      return c.query(mod.sql).then((r) => r.rows);
    });

    const totalRow = {};
    if (mod.columns.some((col) => col.key === 'kg')) totalRow.kg = sum(rows, 'kg');
    if (mod.columns.some((col) => col.key === 'total')) totalRow.total = sum(rows, 'total');
    if (mod.columns.some((col) => col.key === 'balance')) totalRow.balance = sum(rows, 'balance');

    const buf = buildWorkbook({
      title: mod.title + ' — ' + req.companyId,
      sheetName: mod.sheetName,
      columns: mod.columns,
      rows,
      pageSize: Number(process.env.XLSX_PAGE_SIZE || 20), // slice(20)
      totalRow: Object.keys(totalRow).length ? totalRow : undefined,
      totalLabel: 'SHUMA',
    });
    const fname = (modKey + '-' + new Date().toISOString().slice(0, 10) + '.xlsx');
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  } catch (e) {
    console.error('[export:xlsx]', e.message);
    res.status(500).json({ ok: false, error: 'Gabim gjatë eksportit' });
  }
});

// P3 — Backup automatik me dryer (APPLY.md §4, hapi 10)
async function buildCompanyDump(client, companyId) {
  const dump = { companyId, exportedAt: new Date().toISOString(), entities: {} };
  const tables = ['products','suppliers','customers','warehouses','lots','weighings',
                  'payments','customer_payments','sales_invoices','purchase_invoices'];
  for (const t of tables) {
    try {
      const r = await client.query(`SELECT * FROM ${t} WHERE company_id = $1 ORDER BY 1`, [companyId]);
      dump.entities[t] = r.rows;
    } catch (_) {
      dump.entities[t] = [];
    }
  }
  return dump;
}

async function writeBackupFile(companyId, dump) {
  const dir = path.resolve(process.env.AUTO_BACKUP_DIR || './backups');
  fs.mkdirSync(dir, { recursive: true });
  const fname = `backup-${companyId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const fpath = path.join(dir, fname);
  fs.writeFileSync(fpath, JSON.stringify(dump, null, 2));
  try {
    const keep = Number(process.env.AUTO_BACKUP_KEEP || 14);
    const files = fs.readdirSync(dir)
      .filter((f) => f.startsWith(`backup-${companyId}-`) && f.endsWith('.json'))
      .sort();
    while (files.length > keep) {
      const old = files.shift();
      fs.unlinkSync(path.join(dir, old));
    }
  } catch (_) {}
}

async function activeCompanies() {
  return withSystem(async (client) => {
    const r = await client.query('SELECT id FROM companies WHERE active = TRUE');
    return r.rows.map((row) => row.id);
  });
}

async function autoBackup() {
  try {
    for (const companyId of await activeCompanies()) {
      await withCompany({ companyId, userId: 'system', isSuperadmin: true }, async (client) => {
        await runExclusive(client, (process.env.AUTO_BACKUP_LOCK_KEY || 'biobes:auto-backup') + ':' + companyId, async () => {
          const dump = await buildCompanyDump(client, companyId);
          await writeBackupFile(companyId, dump);
        }, 'Backup-i është duke u kryer — provo pas pak');
      });
    }
  } catch (e) {
    console.error('[autoBackup]', e.message);
  }
}

if (process.env.AUTO_BACKUP_CRON !== 'disabled') {
  setInterval(() => {
    if (new Date().getUTCHours() === 3 && new Date().getUTCMinutes() < 15) {
      autoBackup();
    }
  }, 15 * 60 * 1000).unref();
}

app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Endpoint i panjohur' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[fatal]', err.message);
  if (err.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'Kërkesa tejkalon kufirin' });
  res.status(500).json({ ok: false, error: 'Gabim serveri' });
});

(async () => {
  try { if (await migrate()) await ensureAdmin(); }
  catch (e) { console.error('[boot] databaza dështoi:', e.message, '— vazhdohet pa DB.'); }
  app.listen(PORT, '0.0.0.0', () => console.log(`[biobes-api] live në portën ${PORT}`));
})();
