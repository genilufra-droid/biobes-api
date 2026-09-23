'use strict';
/* lib/pgCompany.js — konteksti i kompanisë për ÇDO transaksion (parakusht i RLS).
 *
 * Pse është thelbësor: me një Pool, `SET app.company_id = 'C1'` (pa LOCAL) mbetet
 * në lidhje dhe lidhja e njëjtë i shërben më pas një përdoruesi tjetër → rrjedhje
 * midis kompanive. Këtu përdoret set_config(..., is_local => true) brenda BEGIN/COMMIT,
 * pra konteksti vdes me transaksionin dhe lidhja kthehet e pastër në pool.
 *
 * Përdorimi:
 *   const { withCompany, withSystem, HttpError } = require('./lib/pgCompany');
 *   const rows = await withCompany({ companyId: 'C1', userId: 'u1' }, async (client) => {
 *     const r = await client.query('SELECT * FROM products ORDER BY code');
 *     return r.rows;   // vetëm produktet e C1 — i garanton Postgres-i, jo kodi
 *   });
 *
 *   // Operacione para-autentikimit (login) ose sistem (migrime, backup ditor):
 *   const user = await withSystem((client) => findByUsername(client, 'admin'));
 */
/* Pool-i merret nga ../db (ekziston në biobes-api). Kërkesa është e VONUAR (lazy)
 * që ky modul të mund të provohet edhe jashtë repo-s (shih test-kit-local.cjs, i cili
 * injekton një pool PGlite me setPoolProvider). */
let poolProvider = null;
function setPoolProvider(fn) { poolProvider = fn; }

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (extra && typeof extra === 'object') Object.assign(this, extra);
  }
}

function poolOrThrow() {
  let pool = null;
  if (typeof poolProvider === 'function') pool = poolProvider();
  else pool = require('../db').getPool();
  if (!pool) throw new HttpError(503, 'Databaza nuk është e konfiguruar (DATABASE_URL mungon)');
  return pool;
}

/* Roli i databazës që i nënshtrohet RLS.
 *
 * PSE ËSHTË I DOMOSDOSHËM: PostgreSQL nuk e zbaton RLS për SUPERUSER-in, MADJE as
 * me FORCE ROW LEVEL SECURITY. Shumë shërbime cloud (Aiven `avnadmin`, PGlite
 * `postgres`, Neon, Supabase) lidhen si rol me privilegje të larta → politikat nuk
 * do të kishin asnjë efekt dhe izolimi C1 ≠ C2 do të ishte vetëm "në letër".
 *
 * Zgjidhja: çdo transaksion bën `SET LOCAL ROLE <APP_DB_ROLE>` (rol jo-superuser,
 * jo pronar i tabelave) përpara se të vendosë kontekstin. SET LOCAL = roli rikthehet
 * në atë të seancës pas COMMIT/ROLLBACK, pra lidhja kthehet e pastër në pool.
 *
 * Nëse APP_DB_ROLE nuk është caktuar, moduli punon si më parë (vetëm set_config) —
 * por atëherë DUHET të jesh i sigurt që roli i lidhjes nuk është superuser. */
function appRole() {
  const r = String(process.env.APP_DB_ROLE || '').trim();
  if (!r) return '';
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(r)) {
    throw new HttpError(500, 'APP_DB_ROLE i pavlefshëm: lejohen vetëm shkronja, numra dhe _');
  }
  return r;
}

async function setContext(client, ctx) {
  const role = appRole();
  if (role) await client.query('SET LOCAL ROLE ' + role);
  await client.query(
    "SELECT set_config('app.company_id', $1, true), set_config('app.user_id', $2, true), set_config('app.is_superadmin', $3, true)",
    [
      String((ctx && ctx.companyId) || ''),
      String((ctx && ctx.userId) || ''),
      (ctx && ctx.isSuperadmin) ? 'on' : 'off',
    ]
  );
}

/* Transaksion me kontekst kompanie. `fn(client)` mund të kthejë vlerë ose të hedhë gabim. */
async function withCompany(ctx, fn) {
  const pool = poolOrThrow();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

/* Kontekst sistemi: BYPASS i RLS me app.is_superadmin='on'.
 * VETËM për login/refresh, migrime, backup dhe punë administrimi të brendshme. */
function withSystem(fn) {
  return withCompany({ companyId: '', userId: '', isSuperadmin: true }, fn);
}

/* Kërkesë e vetme (pa fn) — e convenient për GET të thjeshta. */
async function queryCompany(ctx, sql, params) {
  return withCompany(ctx, (client) => client.query(sql, params));
}

/* Ndihmës: lexo kompaninë aktive nga kërkesa (header X-Company-Id → ?company= → defaultCompany).
 * Nuk vendos asgjë vetë — vetëm kthen id-në; anëtarësia kontrollohet më poshtë. */
function companyFromRequest(req) {
  const h = req.get ? req.get('x-company-id') : (req.headers || {})['x-company-id'];
  const q = (req.query && (req.query.company || req.query.companyId)) || '';
  const fromAuth = (req.auth && (req.auth.companyId || req.auth.defaultCompany)) || '';
  return String(h || q || fromAuth || '').trim();
}

/* Middleware: siguron që kompania është e njohur dhe përdoruesi është anëtar i saj.
 * Kthehet 403 nëse nuk është anëtar (izolim edhe para se të pyetet databaza). */
function requireCompanyMembership(options) {
  const opts = options || {};
  return async function requireCompanyMembershipMw(req, res, next) {
    try {
      const pool = poolOrThrow();
      const companyId = companyFromRequest(req) || (req.auth && req.auth.defaultCompany) || '';
      if (!companyId) {
        return res.status(400).json({ ok: false, error: 'Mungon kompania (X-Company-Id ose ?company=)' });
      }
      const userId = (req.auth && (req.auth.userId || req.auth.sub)) || '';
      const isSuper = !!(req.auth && req.auth.isSuperadmin);

      // Kontrolli i anëtarësisë bëhet me kontekst sistemi: lexon company_users pa RLS
      // (përndryshe politika do kërkonte vetë kontekstin që po përpiqemi ta vërtetojmë).
      const r = await pool.query(
        `SELECT 1
           FROM company_users cu
           JOIN companies c ON c.id = cu.company_id
          WHERE cu.company_id = $1 AND cu.user_id = $2 AND c.active = TRUE
          LIMIT 1`,
        [companyId, userId]
      );
      if (!isSuper && (!userId || r.rowCount === 0)) {
        if (opts.allowInactive) { /* lejohet leximi i kompanive të çaktivizuara */ }
        else return res.status(403).json({ ok: false, error: 'Nuk jeni anëtar i kësaj kompanie' });
      }
      req.companyId = companyId;
      req.companyCtx = { companyId, userId, isSuperadmin: isSuper };
      next();
    } catch (e) {
      if (e && e.status) return res.status(e.status).json({ ok: false, error: e.message });
      console.error('[requireCompanyMembership]', e.message);
      res.status(500).json({ ok: false, error: 'Gabim në verifikimin e kompanisë' });
    }
  };
}

module.exports = { withCompany, withSystem, queryCompany, companyFromRequest, requireCompanyMembership, setContext, setPoolProvider, HttpError };
