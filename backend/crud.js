// CRUD i përgjithshëm mbi tabelat relacionale të biznesit (migrimi 009).
// Çdo tabelë ka (company_id, id); kompania vjen nga middleware-i
// companies.needCompany() → req.company, kështu që një kompani nuk sheh
// kurrë të dhënat e tjetrës.
//
// Erdhi nga dega arena/01a0be23-biobes-api (aty ishte buildCrud brenda
// company.js). Gjatë bashkimit me main u ndava në modul më vete sepse
// pjesa tjetër e company.js (userCompanies, loadCompanyContext, requireCompany)
// ishte zëvendësuar tashmë nga companies.js i main-it (Modeli B).
const crypto = require('crypto');
const { getPool } = require('./db');

const COMPANY = (req) => req.company || req.companyId || '';

// Rrit versionin e kompanisë dhe njofton vetëm pajisjet e asaj kompanie.
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
    // events.js filtron vetë sipas kompanisë (shih events.broadcast).
    const events = require('./events');
    events.broadcast('entity-changed', {
      companyId, version: r.rows[0].version, at: r.rows[0].updated_at, actor: actor || '',
    }, { company: companyId });
  } catch (e) { /* mos e thyen kërkesën nëse regjistri i sinkronizimit dështon */ }
}

// Ndërton handler-at list/get/create/update/remove për një tabelë.
function buildCrud(table, { defaultSort = 'created_at DESC', searchColumns = ['name', 'code'], jsonColumns = ['meta'], numericColumns = [] } = {}) {
  const guarded = (fn) => async (req, res) => {
    if (!COMPANY(req)) return res.status(400).json({ ok: false, error: 'Zgjidhni një kompani (?company= ose header X-Company-Id)' });
    return fn(req, res);
  };
  const clean = (body, jsonColumns) => {
    const out = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (['id', 'company_id', 'created_at', 'updated_at'].includes(k)) continue;
      out[k] = jsonColumns.includes(k) ? JSON.stringify(v && typeof v === 'object' ? v : {}) : v;
    }
    return out;
  };

  return {
    list: guarded(async (req, res) => {
      try {
        const p = getPool();
        const limit = Math.min(Math.max(+req.query.limit || 200, 1), 1000);
        const offset = Math.max(+req.query.offset || 0, 0);
        const q = (req.query.q || '').toString().trim();
        const params = [COMPANY(req)];
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
        res.json({ ok: true, company: COMPANY(req), rows, total: totalR.rows[0].c, limit, offset });
      } catch (e) { console.error('[' + table + ':list]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
    }),

    get: guarded(async (req, res) => {
      try {
        const { rows } = await getPool().query(`SELECT * FROM ${table} WHERE company_id=$1 AND id=$2`, [COMPANY(req), req.params.id]);
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
        res.json({ ok: true, row: rows[0] });
      } catch (e) { console.error('[' + table + ':get]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
    }),

    create: guarded(async (req, res) => {
      try {
        const body = req.body || {};
        const id = body.id || (table.slice(0, 3).toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase());
        const p = getPool();
        const data = clean(body, jsonColumns);
        const keys = Object.keys(data);
        const cols = ['company_id', 'id', ...keys, 'updated_at'];
        const vals = [COMPANY(req), id, ...keys.map((k) => data[k])];
        const ph = cols.map((c, i) => (c === 'updated_at' ? 'NOW()' : '$' + (i + 1)));
        const { rows } = await p.query(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph.join(',')}) RETURNING *`, vals
        );
        await bumpVersion(COMPANY(req), req.user && req.user.username);
        res.status(201).json({ ok: true, row: rows[0] });
      } catch (e) {
        if (/duplicate|unique/i.test(String(e.message))) return res.status(409).json({ ok: false, error: 'Ekziston një rresht me këtë ID' });
        console.error('[' + table + ':create]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' });
      }
    }),

    update: guarded(async (req, res) => {
      try {
        const p = getPool();
        const data = clean(req.body, jsonColumns);
        const keys = Object.keys(data);
        if (!keys.length) return res.status(400).json({ ok: false, error: 'Asnjë fushë për përditësim' });
        const set = keys.map((k, i) => `${k} = $${i + 3}`).concat(['updated_at = NOW()']);
        const { rows } = await p.query(
          `UPDATE ${table} SET ${set.join(', ')} WHERE company_id=$1 AND id=$2 RETURNING *`,
          [COMPANY(req), req.params.id, ...keys.map((k) => data[k])]
        );
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
        await bumpVersion(COMPANY(req), req.user && req.user.username);
        res.json({ ok: true, row: rows[0] });
      } catch (e) { console.error('[' + table + ':update]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
    }),

    remove: guarded(async (req, res) => {
      try {
        const { rowCount } = await getPool().query(`DELETE FROM ${table} WHERE company_id=$1 AND id=$2`, [COMPANY(req), req.params.id]);
        if (!rowCount) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
        await bumpVersion(COMPANY(req), req.user && req.user.username);
        res.json({ ok: true, deleted: req.params.id });
      } catch (e) { console.error('[' + table + ':remove]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
    }),
  };
}

module.exports = { buildCrud, bumpVersion };
