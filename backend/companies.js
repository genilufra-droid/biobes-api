// BioBes API — multi-company (Modeli B): kompanitë, anëtarësia dhe kontrolli i qasjes.
//
// Rregullat:
//  - Çdo kërkesë pune (state, backup, audit, wipe) ka një kompani: `?company=C1`
//    ose `company` në trupin e kërkesës. Pa parametër → kompania e parazgjedhur
//    e përdoruesit (ose DEFAULT_COMPANY, parazgjedhur 'C1') → klienti i vjetër
//    vazhdon të punojë pa asnjë ndryshim.
//  - Anëtarësia kontrollohet në server: kush nuk është në `user_companies` për
//    atë kompani merr 403 — edhe sikur ta ndryshojë kompaninë nga shfletuesi.
//  - Administratori (ROLE-ADMIN / is_superuser) ka qasje në të gjitha kompanitë.
const { getPool } = require('./db');
const access = require('./access');

const DEFAULT_COMPANY_ID = String(process.env.DEFAULT_COMPANY || 'C1');
const LEGACY_COMPANY_ID = 'main'; // skema e vjetër: një rresht i vetëm me id='main'

function isSuperuser(user) { return access.isSuperuser(user); }

async function listCompanies(pool) {
  const p = pool || getPool();
  const { rows } = await p.query('SELECT id,code,name,nipt,address,city,country,vat_rate,currency,active,created_at FROM companies ORDER BY created_at, id');
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.name, nipt: r.nipt, address: r.address, city: r.city,
    country: r.country, vatRate: Number(r.vat_rate), currency: r.currency, active: r.active,
    createdAt: r.created_at,
  }));
}

async function defaultCompanyFor(user, pool) {
  const p = pool || getPool();
  try {
    const { rows } = await p.query(
      'SELECT company_id FROM user_companies WHERE user_id=$1 ORDER BY is_default DESC, company_id LIMIT 1', [user && user.id]);
    if (rows.length) return rows[0].company_id;
  } catch (e) { /* pa anëtarësi (DB e vjetër pa migrim) */ }
  return DEFAULT_COMPANY_ID;
}

// Lista e kompanive që sheh përdoruesi (me `isDefault`), për /api/auth/login dhe /api/auth/me.
async function contextFor(user, pool) {
  const p = pool || getPool();
  let rows = [];
  try {
    if (isSuperuser(user)) {
      const all = await listCompanies(p);
      const def = await defaultCompanyFor(user, p);
      rows = all.map((c) => ({ id: c.id, code: c.code, name: c.name, active: c.active, isDefault: c.id === def }));
    } else {
      const { rows: rs } = await p.query(
        `SELECT c.id, c.code, c.name, c.active, uc.is_default
           FROM user_companies uc JOIN companies c ON c.id = uc.company_id
          WHERE uc.user_id = $1
          ORDER BY uc.is_default DESC, c.created_at, c.id`, [user && user.id]);
      rows = rs.map((r) => ({ id: r.id, code: r.code, name: r.name, active: r.active, isDefault: !!r.is_default }));
    }
  } catch (e) {
    console.error('[companies] contextFor:', e.message);
    rows = [];
  }
  const active = rows.filter((c) => c.active !== false);
  const dft = (rows.find((c) => c.isDefault) || active[0] || rows[0] || {}).id || DEFAULT_COMPANY_ID;
  return {
    companies: rows,
    defaultCompany: dft,
    // Frontend-i aktivizon regjimin multi-company vetëm kur ka më shumë se një kompani.
    multiCompany: active.length > 1,
  };
}

// A lejohet përdoruesi në këtë kompani?
async function assertCompanyAccess(user, companyId, pool) {
  if (!user) return { ok: false, code: 401, error: 'Sesioni ka skaduar — hyni përsëri' };
  const p = pool || getPool();
  const id = String(companyId || '').trim();
  if (!id) return { ok: true, id: null };
  const c = await p.query('SELECT id,active FROM companies WHERE id=$1', [id]);
  if (!c.rows.length) return { ok: false, code: 404, error: 'Kompania nuk u gjet' };
  if (isSuperuser(user)) return { ok: true, id };
  const m = await p.query('SELECT 1 FROM user_companies WHERE user_id=$1 AND company_id=$2', [user.id, id]);
  if (!m.rows.length) return { ok: false, code: 403, error: 'Nuk keni të drejtë për këtë kompani' };
  return { ok: true, id };
}

// Middleware: vendos req.company (id i kompanisë) duke respektuar anëtarësinë.
function needCompany() {
  return async (req, res, next) => {
    try {
      const q = (req.query && req.query.company) || (req.body && req.body.company) || '';
      const wanted = String(q).trim();
      if (!wanted) {
        req.company = await defaultCompanyFor(req.user);
        req.companyExplicit = false;
        return next();
      }
      const a = await assertCompanyAccess(req.user, wanted);
      if (!a.ok) return res.status(a.code || 403).json({ ok: false, error: a.error });
      req.company = a.id;
      req.companyExplicit = true;
      next();
    } catch (e) { console.error('[companies] needCompany:', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
  };
}

// ===== Epoka e wipe-it per kompani =====
const wipeKey = (companyId) => 'wiped_at:' + companyId;

async function getWipeMark(pool, companyId) {
  const p = pool || getPool();
  const { rows } = await p.query('SELECT key,value FROM meta WHERE key IN ($1,$2)', [wipeKey(companyId), 'wiped_at']);
  const own = rows.find((r) => r.key === wipeKey(companyId));
  if (own) return own.value;
  // Pajtueshmëri me skemën e vjetër: shenja e përbashkët vlen vetëm për kompaninë e parazgjedhur.
  const legacy = rows.find((r) => r.key === 'wiped_at');
  if (legacy && companyId === DEFAULT_COMPANY_ID) return legacy.value;
  return null;
}

async function setWipeMark(pool, companyId) {
  const p = pool || getPool();
  await p.query('INSERT INTO meta(key,value) VALUES($1, NOW()::text) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [wipeKey(companyId)]);
}

async function clearWipeMark(pool, companyId) {
  const p = pool || getPool();
  await p.query('DELETE FROM meta WHERE key=$1', [wipeKey(companyId)]);
  if (companyId === DEFAULT_COMPANY_ID) await p.query("DELETE FROM meta WHERE key='wiped_at'");
}

module.exports = {
  DEFAULT_COMPANY_ID,
  LEGACY_COMPANY_ID,
  isSuperuser,
  listCompanies,
  defaultCompanyFor,
  contextFor,
  assertCompanyAccess,
  needCompany,
  getWipeMark,
  setWipeMark,
  clearWipeMark,
  wipeKey,
};
