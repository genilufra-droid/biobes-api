// CRUD i përgjithshëm mbi tabelat relacionale të biznesit (migrimi 009).
// Çdo tabelë ka (company_id, id); kompania vjen nga middleware-i
// companies.needCompany() → req.company, kështu që një kompani nuk sheh
// kurrë të dhënat e tjetrës.
//
// Erdhi nga dega arena/01a0be23-biobes-api (aty ishte buildCrud brenda
// company.js). Gjatë bashkimit me main u ndava në modul më vete sepse
// pjesa tjetër e company.js (userCompanies, loadCompanyContext, requireCompany)
// ishte zëvendësuar tashmë nga companies.js i main-it (Modeli B).
//
// SIGURIA (Faza A e auditimit): emrat e kolonave nuk merren më verbatim nga
// trupi i kërkesës. Çdo çelës kalon nëpër (a) normalizim të shkronjave,
// (b) refuzim të fushave të rezervuara — përfshirë `Company_ID`, që më parë
// anashkalonte filtrin dhe zhvendoste rreshta midis kompanive — dhe
// (c) një whitelist të lexuar nga information_schema.columns.
const crypto = require('crypto');
const { getPool } = require('./db');

const COMPANY = (req) => req.company || req.companyId || '';

// Fusha që klienti nuk i vendos kurrë: id dhe company_id i caktohen nga
// serveri, created_at/updated_at nga databaza. Krahasimi bëhet me shkronja
// të vogla, sepse Postgres i palos identifikuesit e pa-cituar.
const RESERVED = new Set(['id', 'company_id', 'created_at', 'updated_at']);
// Forma e lejuar e një emri kolone.
const IDENT = /^[a-z_][a-z0-9_]*$/;

// Kolonat e vërteta të tabelës, lexuar një herë nga information_schema dhe
// mbajtur në cache (skema nuk ndryshon gjatë jetës së procesit).
const columnCache = new Map();
async function allowedColumns(table) {
  if (columnCache.has(table)) return columnCache.get(table);
  const { rows } = await getPool().query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  const set = new Set(rows.map((r) => r.column_name));
  columnCache.set(table, set);
  return set;
}

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
function buildCrud(table, opts = {}) {
  const {
    defaultSort = 'created_at DESC',
    searchColumns = ['name', 'code'],
    jsonColumns = ['meta'],
    audit = null, // (action, actor, company, row) → e thërret server.js për gjurmën e auditimit
  } = opts;

  const guarded = (fn) => async (req, res) => {
    if (!COMPANY(req)) return res.status(400).json({ ok: false, error: 'Zgjidhni një kompani (?company= ose header X-Company-Id)' });
    return fn(req, res);
  };

  // Lexon dhe vërteton fushat e ardhura nga klienti.
  // Kthen { ok: true, data } ose { ok: false, field } — kurrë nuk i fut
  // emrat e klientit direkt në SQL.
  async function readFields(req) {
    const allowed = await allowedColumns(table);
    const data = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      const key = String(k).toLowerCase();
      if (RESERVED.has(key)) continue; // injorohet në heshtje (përputhshmëri me klientët)
      if (!IDENT.test(key) || !allowed.has(key)) return { ok: false, field: String(k) };
      data[key] = jsonColumns.includes(key) ? JSON.stringify(v && typeof v === 'object' ? v : {}) : v;
    }
    return { ok: true, data };
  }

  const rejectField = (res, field) =>
    res.status(400).json({ ok: false, error: 'Fushë e panjohur ose e palëvizshme: ' + String(field).slice(0, 60) });

  const writeAudit = async (req, action, row) => {
    if (!audit) return;
    try { await audit(action, (req.user && req.user.username) || '', COMPANY(req), row); } catch (e) {}
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
          const conds = searchColumns.filter((c) => IDENT.test(c)).map((col, i) => `${col} ILIKE $${params.length + 1 + i}`);
          where += ' AND (' + conds.join(' OR ') + ')';
          conds.forEach(() => params.push('%' + q + '%'));
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
        const f = await readFields(req);
        if (!f.ok) return rejectField(res, f.field);
        const keys = Object.keys(f.data);
        const cols = ['company_id', 'id', ...keys, 'updated_at'];
        const id = (req.body || {}).id || (table.slice(0, 3).toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase());
        const vals = [COMPANY(req), String(id), ...keys.map((k) => f.data[k])];
        const ph = cols.map((c, i) => (c === 'updated_at' ? 'NOW()' : '$' + (i + 1)));
        const { rows } = await getPool().query(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph.join(',')}) RETURNING *`, vals
        );
        await bumpVersion(COMPANY(req), req.user && req.user.username);
        await writeAudit(req, 'ENTITY_CREATE', rows[0]);
        res.status(201).json({ ok: true, row: rows[0] });
      } catch (e) {
        if (/duplicate|unique/i.test(String(e.message))) return res.status(409).json({ ok: false, error: 'Ekziston një rresht me këtë ID' });
        console.error('[' + table + ':create]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' });
      }
    }),

    update: guarded(async (req, res) => {
      try {
        const f = await readFields(req);
        if (!f.ok) return rejectField(res, f.field);
        const keys = Object.keys(f.data);
        if (!keys.length) return res.status(400).json({ ok: false, error: 'Asnjë fushë për përditësim' });
        const set = keys.map((k, i) => `${k} = $${i + 3}`).concat(['updated_at = NOW()']);
        const { rows } = await getPool().query(
          `UPDATE ${table} SET ${set.join(', ')} WHERE company_id=$1 AND id=$2 RETURNING *`,
          [COMPANY(req), req.params.id, ...keys.map((k) => f.data[k])]
        );
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
        await bumpVersion(COMPANY(req), req.user && req.user.username);
        await writeAudit(req, 'ENTITY_UPDATE', rows[0]);
        res.json({ ok: true, row: rows[0] });
      } catch (e) { console.error('[' + table + ':update]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
    }),

    remove: guarded(async (req, res) => {
      try {
        const { rows } = await getPool().query(`DELETE FROM ${table} WHERE company_id=$1 AND id=$2 RETURNING id`, [COMPANY(req), req.params.id]);
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
        await bumpVersion(COMPANY(req), req.user && req.user.username);
        await writeAudit(req, 'ENTITY_DELETE', rows[0]);
        res.json({ ok: true, deleted: rows[0].id });
      } catch (e) { console.error('[' + table + ':remove]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
    }),
  };
}

module.exports = { buildCrud, bumpVersion, allowedColumns };
