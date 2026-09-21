// BioBes API — Middleware dhe CRUD për multi-company.
// Çdo kërkesë e autentikuar që mbart `X-Company-Id` (ose kompania e vetme e userit)
// vendos `req.companyId`. Të gjitha query-të më poshtë filtrojnë `WHERE company_id=$1`,
// kështu që kompanitë izolohen plotësisht në nivel databaze.
const crypto = require('crypto');
const { getPool } = require('./db');

// Kompani të cilave useri ka qasje (përfshirë role_in_company).
async function userCompanies(userId, pool) {
  const p = pool || getPool();
  const { rows } = await p.query(
    `SELECT c.id, c.name, c.tax_id, c.currency, c.active, cu.role_in_company, cu.is_default
     FROM companies c
     JOIN company_users cu ON cu.company_id = c.id
     WHERE cu.user_id = $1 AND c.active = TRUE
     ORDER BY cu.is_default DESC, c.name ASC`,
    [userId]
  );
  return rows;
}

// Gjen kompaninë "aktive" të një useri:
// 1) Nëse headeri X-Company-Id është dhënë dhe ai i përket userit → e zgjedh atë.
// 2) Përndryshe kompania e vetme që ka useri (ose is_default=true).
async function resolveActiveCompany(userId, requestedId, pool) {
  const p = pool || getPool();
  const list = await userCompanies(userId, p);
  if (!list.length) return null;
  if (requestedId) {
    const match = list.find((c) => c.id === requestedId);
    if (match) return match;
  }
  const def = list.find((c) => c.is_default) || list[0];
  return def;
}

// Middleware që vendos req.companyId. Nuk bllokon nëse s'ka kompani (për
// endpoint-et që s'kërkojnë kompani, si /api/companies/list, /api/auth/me).
async function loadCompanyContext(req, res, next) {
  req.companyId = null;
  req.companyRole = null;
  if (!req.user) return next();
  // Superadmina globale (ROLE-ADMIN pa lidhje kompani) mund të shohë çdo kompani.
  if (req.user.is_superadmin || req.user.role === 'ROLE-ADMIN') {
    const cid = req.headers['x-company-id'] ? String(req.headers['x-company-id']) : null;
    if (cid) {
      const check = await getPool().query('SELECT id FROM companies WHERE id=$1', [cid]);
      if (check.rows.length) { req.companyId = cid; req.companyRole = 'owner'; return next(); }
    }
    if (!cid) {
      // Nëse s'u dha cid, marrim kompaninë e parë të userit (nëse ka), ose asnjë.
      const list = await userCompanies(req.user.id);
      if (list.length) { req.companyId = list[0].id; req.companyRole = list[0].role_in_company; }
      return next();
    }
  }
  const requestedId = req.headers['x-company-id'] ? String(req.headers['x-company-id']) : null;
  const c = await resolveActiveCompany(req.user.id, requestedId);
  if (c) { req.companyId = c.id; req.companyRole = c.role_in_company; }
  next();
}

// Middleware që kërkon kompani (400 nëse s'ka).
function requireCompany(req, res, next) {
  if (!req.companyId) return res.status(400).json({ ok: false, error: 'Zgjidhni një kompani (X-Company-Id header)', availableCompanies: req.user ? [] : [] });
  next();
}

// Ndihmës CRUD gjenerik për tabelat me (company_id, id, …).
function buildCrud(table, { defaultSort = 'created_at DESC', searchColumns = ['name', 'code'], jsonColumns = ['meta'], numericColumns = [], allowPartialUpdate = true } = {}) {
  return {
    async list(req, res) {
      try {
        const p = getPool();
        const limit = Math.min(Math.max(+req.query.limit || 200, 1), 1000);
        const offset = Math.max(+req.query.offset || 0, 0);
        const q = (req.query.q || '').toString().trim();
        const params = [req.companyId];
        let where = 'WHERE company_id = $1';
        if (q) {
          const conds = searchColumns.map((col, i) => `${col} ILIKE $${params.length + 1 + i}`);
          where += ' AND (' + conds.join(' OR ') + ')';
          searchColumns.forEach(() => params.push('%' + q + '%'));
        }
        const { rows } = await p.query(
          `SELECT * FROM ${table} ${where} ORDER BY ${defaultSort} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset]
        );
        const totalR = await p.query(`SELECT COUNT(*)::int AS c FROM ${table} ${where}`, params);
        res.json({ ok: true, rows, total: totalR.rows[0].c, limit, offset });
      } catch (e) { console.error('[' + table + ':list]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
    },
    async get(req, res) {
      try {
        const { rows } = await getPool().query(`SELECT * FROM ${table} WHERE company_id=$1 AND id=$2`, [req.companyId, req.params.id]);
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
        res.json({ ok: true, row: rows[0] });
      } catch (e) { console.error('[' + table + ':get]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
    },
    async create(req, res) {
      try {
        const body = req.body || {};
        const id = body.id || (table.slice(0, 3).toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase());
        const p = getPool();
        const cols = ['company_id', 'id'];
        const vals = [req.companyId, id];
        const placeholders = ['$1', '$2'];
        let i = 3;
        for (const [k, v] of Object.entries(body)) {
          if (k === 'id' || k === 'company_id' || k === 'created_at' || k === 'updated_at') continue;
          cols.push(k);
          placeholders.push('$' + (i++));
          vals.push(jsonColumns.includes(k) ? JSON.stringify(v && typeof v === 'object' ? v : {}) : v);
        }
        cols.push('updated_at'); placeholders.push('NOW()');
        const { rows } = await p.query(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`,
          vals
        );
        await bumpVersion(req.companyId, req.user && req.user.username);
        res.status(201).json({ ok: true, row: rows[0] });
      } catch (e) {
        if (/duplicate|unique/i.test(String(e.message))) return res.status(409).json({ ok: false, error: 'Ekziston një rresht me këtë ID' });
        console.error('[' + table + ':create]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' });
      }
    },
    async update(req, res) {
      try {
        const body = req.body || {};
        const p = getPool();
        const set = [];
        const vals = [req.companyId, req.params.id];
        let i = 3;
        for (const [k, v] of Object.entries(body)) {
          if (k === 'id' || k === 'company_id' || k === 'created_at' || k === 'updated_at') continue;
          set.push(k + ' = $' + (i++));
          vals.push(jsonColumns.includes(k) ? JSON.stringify(v && typeof v === 'object' ? v : {}) : v);
        }
        set.push('updated_at = NOW()');
        if (!set.length) return res.status(400).json({ ok: false, error: 'Asnjë fushë për përditësim' });
        const { rows } = await p.query(
          `UPDATE ${table} SET ${set.join(', ')} WHERE company_id=$1 AND id=$2 RETURNING *`,
          vals
        );
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
        await bumpVersion(req.companyId, req.user && req.user.username);
        res.json({ ok: true, row: rows[0] });
      } catch (e) { console.error('[' + table + ':update]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
    },
    async remove(req, res) {
      try {
        const { rowCount } = await getPool().query(`DELETE FROM ${table} WHERE company_id=$1 AND id=$2`, [req.companyId, req.params.id]);
        if (!rowCount) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
        await bumpVersion(req.companyId, req.user && req.user.username);
        res.json({ ok: true, deleted: req.params.id });
      } catch (e) { console.error('[' + table + ':remove]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
    },
  };
}

// Rrit versionin e kompanisë dhe dërgon event SSE.
async function bumpVersion(companyId, actor) {
  if (!companyId) return;
  try {
    const p = getPool();
    const r = await p.query(
      `INSERT INTO company_sync(company_id,version,updated_at) VALUES($1,1,NOW())
       ON CONFLICT(company_id) DO UPDATE SET version=company_sync.version+1, updated_at=NOW()
       RETURNING version, updated_at`,
      [companyId]
    );
    // Importohet dinamikisht për të mos krijuar cikël me server.js.
    const { broadcastCompanyEvent } = require('./server-realtime');
    broadcastCompanyEvent(companyId, 'entity-changed', {
      companyId, version: r.rows[0].version, at: r.rows[0].updated_at, actor: actor || ''
    });
  } catch (e) { /* mbyllur heshtur */ }
}

module.exports = {
  userCompanies,
  resolveActiveCompany,
  loadCompanyContext,
  requireCompany,
  buildCrud,
  bumpVersion,
};
