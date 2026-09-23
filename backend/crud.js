// CRUD i përgjithshëm mbi tabelat relacionale të biznesit (migrimet 009 + 010).
//
// Çdo tabelë ka (company_id, id). Kompania vjen nga middleware-i
// companies.needCompany() → req.company, dhe çdo pyetje ekzekutohet Brenda
// db.withCompany(), që vendos kontekstin për RLS-në e migrimit 010.
//
// Sjelljet e reja krahas versionit të parë:
//   * fshirje e butë (tombstones) — rreshti mbetet me deleted_at, që pajisjet
//     e tjera ta marrin ndryshimin me ?since=;
//   * version për rresht — klienti që dërgon If-Match të vjetër merr 409;
//   * unicitet (company_id, code) — indeks unik pjesor në databazë.
const crypto = require('crypto');
const { getPool, withCompany } = require('./db');
const { log } = require('./log');

const COMPANY = (req) => req.company || req.companyId || '';
// Konteksti i plotë për RLS-në (010_rls + 015): pa userId, politikat e anëtarësisë
// nuk njohin përdoruesin dhe CRUD-i do të kthente zero rreshta.
const CTX = (req) => ({
  companyId: COMPANY(req),
  userId: (req.user && req.user.id) || '',
  isSuperadmin: !!(req.user && (req.user.is_superadmin || req.user.role === 'ROLE-ADMIN')),
});

// Fushat që klienti nuk i vendos kurrë. Krahasimi bëhet me shkronja të vogla,
// sepse Postgres i palos identifikuesit e pa-cituar ('Company_ID' = company_id).
const RESERVED = new Set(['id', 'company_id', 'created_at', 'updated_at', 'deleted_at', 'version']);
const IDENT = /^[a-z_][a-z0-9_]*$/;

// Kolonat e vërteta të tabelës (whitelist nga information_schema, në cache).
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
    const events = require('./events');
    events.broadcast('entity-changed', {
      companyId, version: r.rows[0].version, at: r.rows[0].updated_at, actor: actor || '',
    }, { company: companyId });
  } catch (e) { /* mos e thyen kërkesën nëse regjistri i sinkronizimit dështon */ }
}

function buildCrud(table, opts = {}) {
  const {
    defaultSort = 'created_at DESC',
    searchColumns = ['name', 'code'],
    jsonColumns = ['meta'],
    audit = null,
    label = table,
  } = opts;

  const guarded = (fn) => async (req, res) => {
    if (!COMPANY(req)) return res.status(400).json({ ok: false, error: 'Zgjidhni një kompani (?company= ose header X-Company-Id)' });
    try { return await fn(req, res); }
    catch (e) {
      if (/new row violates row-level security|violates row-level security policy/i.test(String(e.message))) {
        log.warn('crud: RLS refuzoi — izolimi i kompanive funksionoi', { table: table, reqId: req.id });
        return res.status(403).json({ ok: false, error: 'Kjo e dhënë nuk i përket kompanisë tuaj' });
      }
      throw e;
    }
  };

  async function readFields(req) {
    const allowed = await allowedColumns(table);
    const data = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      const key = String(k).toLowerCase();
      if (RESERVED.has(key)) continue;
      if (!IDENT.test(key) || !allowed.has(key)) return { ok: false, field: String(k) };
      data[key] = jsonColumns.includes(key) ? JSON.stringify(v && typeof v === 'object' ? v : {}) : v;
    }
    return { ok: true, data };
  }

  const rejectField = (res, field) =>
    res.status(400).json({ ok: false, error: 'Fushë e panjohur ose e palëvizshme: ' + String(field).slice(0, 60) });

  const writeAudit = async (req, action, row) => {
    if (!audit) return;
    try { await audit(action, (req.user && req.user.username) || '', COMPANY(req), row, label); } catch (e) {}
  };

  return {
    list: guarded(async (req, res) => {
      try {
        const limit = Math.min(Math.max(+req.query.limit || 200, 1), 1000);
        const offset = Math.max(+req.query.offset || 0, 0);
        const q = (req.query.q || '').toString().trim();
        const since = (req.query.since || '').toString().trim();
        const includeDeleted = String(req.query.includeDeleted || '') === '1' || !!since;
        const params = [COMPANY(req)];
        let where = 'WHERE company_id = $1';
        // Sinkronizimi: ?since=ISO kthen çdo rresht të prekur që nga ajo kohë,
        // përfshirë tombstone-t (deleted_at IS NOT NULL).
        if (since) { where += ` AND updated_at > $2::timestamptz`; params.push(since); }
        else if (!includeDeleted) where += ' AND deleted_at IS NULL';
        if (q) {
          const cols = searchColumns.filter((c) => IDENT.test(c));
          const conds = cols.map((col, i) => `${col} ILIKE $${params.length + 1 + i}`);
          where += ' AND (' + conds.join(' OR ') + ')';
          cols.forEach(() => params.push('%' + q + '%'));
        }
        const out = await withCompany(CTX(req), async (c) => {
          const { rows } = await c.query(
            `SELECT * FROM ${table} ${where} ORDER BY ${defaultSort} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
          );
          const totalR = await c.query(`SELECT COUNT(*)::int AS c FROM ${table} ${where}`, params);
          return { rows, total: totalR.rows[0].c };
        });
        res.json({ ok: true, company: COMPANY(req), rows: out.rows, total: out.total, limit, offset, since: since || null });
      } catch (e) {
        log.exception('crud:list', e, { table, reqId: req.id });
        res.status(500).json({ ok: false, error: 'Gabim serveri' });
      }
    }),

    get: guarded(async (req, res) => {
      try {
        const out = await withCompany(CTX(req), async (c) => {
          const { rows } = await c.query(
            `SELECT * FROM ${table} WHERE company_id=$1 AND id=$2 AND deleted_at IS NULL`, [COMPANY(req), req.params.id]);
          return rows[0] || null;
        });
        if (!out) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
        res.json({ ok: true, row: out });
      } catch (e) {
        log.exception('crud:get', e, { table, reqId: req.id });
        res.status(500).json({ ok: false, error: 'Gabim serveri' });
      }
    }),

    create: guarded(async (req, res) => {
      try {
        const f = await readFields(req);
        if (!f.ok) return rejectField(res, f.field);
        const keys = Object.keys(f.data);
        const id = (req.body || {}).id || (table.slice(0, 3).toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase());
        const cols = ['company_id', 'id', ...keys, 'version', 'updated_at'];
        const vals = [COMPANY(req), String(id), ...keys.map((k) => f.data[k])];
        const ph = cols.map((c, i) => (c === 'updated_at' ? 'NOW()' : c === 'version' ? '1' : '$' + (i + 1)));
        const out = await withCompany(CTX(req), async (c) => {
          const { rows } = await c.query(
            `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph.join(',')}) RETURNING *`, vals);
          return rows[0];
        });
        await bumpVersion(COMPANY(req), req.user && req.user.username);
        await writeAudit(req, 'ENTITY_CREATE', out);
        res.status(201).json({ ok: true, row: out });
      } catch (e) {
        if (/_uniq|duplicate key|violates unique/i.test(String(e.message))) {
          return res.status(409).json({ ok: false, error: 'Ekziston një rresht me këtë kod/ID në këtë kompani' });
        }
        log.exception('crud:create', e, { table, reqId: req.id });
        res.status(500).json({ ok: false, error: 'Gabim serveri' });
      }
    }),

    update: guarded(async (req, res) => {
      try {
        const f = await readFields(req);
        if (!f.ok) return rejectField(res, f.field);
        const keys = Object.keys(f.data);
        if (!keys.length) return res.status(400).json({ ok: false, error: 'Asnjë fushë për përditësim' });
        // Kontroll optimist: nëse klienti dërgon If-Match (ose baseVersion),
        // refuzohet me 409 kur dikush tjetër e ka ndryshuar që më parë.
        const want = Number(req.headers['if-match'] || (req.body || {}).baseVersion);
        const set = keys.map((k, i) => `${k} = $${i + 3}`).concat(['version = version + 1', 'updated_at = NOW()']);
        const out = await withCompany(CTX(req), async (c) => {
          const cur = await c.query(`SELECT version FROM ${table} WHERE company_id=$1 AND id=$2 AND deleted_at IS NULL`, [COMPANY(req), req.params.id]);
          if (!cur.rows.length) return null;
          if (Number.isFinite(want) && want > 0 && Number(cur.rows[0].version) !== want) return { conflict: cur.rows[0].version };
          const { rows } = await c.query(
            `UPDATE ${table} SET ${set.join(', ')} WHERE company_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING *`,
            [COMPANY(req), req.params.id, ...keys.map((k) => f.data[k])]
          );
          return rows[0] || null;
        });
        if (!out) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
        if (out.conflict) return res.status(409).json({ ok: false, error: 'Konflikt versionesh — rreshti u ndryshua diku tjetër', version: out.conflict });
        await bumpVersion(COMPANY(req), req.user && req.user.username);
        await writeAudit(req, 'ENTITY_UPDATE', out);
        res.json({ ok: true, row: out });
      } catch (e) {
        if (/_uniq|duplicate key|violates unique/i.test(String(e.message))) {
          return res.status(409).json({ ok: false, error: 'Ekziston një rresht me këtë kod/ID në këtë kompani' });
        }
        log.exception('crud:update', e, { table, reqId: req.id });
        res.status(500).json({ ok: false, error: 'Gabim serveri' });
      }
    }),

    // Fshirje e butë si parazgjedhje. ?hard=1 (vetëm admin) e fshin vërtet —
    // për kërkesat "fshij të dhënat e mia".
    remove: guarded(async (req, res) => {
      try {
        const hard = String(req.query.hard || '') === '1' && req.user && req.user.role === 'ROLE-ADMIN';
        const out = await withCompany(CTX(req), async (c) => {
          if (hard) {
            const r = await c.query(`DELETE FROM ${table} WHERE company_id=$1 AND id=$2 RETURNING id`, [COMPANY(req), req.params.id]);
            return r.rows[0] || null;
          }
          const r = await c.query(
            `UPDATE ${table} SET deleted_at=NOW(), version=version+1, updated_at=NOW()
              WHERE company_id=$1 AND id=$2 AND deleted_at IS NULL
             RETURNING id, deleted_at, version`, [COMPANY(req), req.params.id]);
          return r.rows[0] || null;
        });
        if (!out) return res.status(404).json({ ok: false, error: 'Nuk u gjet' });
        await bumpVersion(COMPANY(req), req.user && req.user.username);
        await writeAudit(req, hard ? 'ENTITY_PURGE' : 'ENTITY_DELETE', out);
        res.json({ ok: true, deleted: out.id, deletedAt: out.deleted_at || null, hard: !!hard });
      } catch (e) {
        log.exception('crud:remove', e, { table, reqId: req.id });
        res.status(500).json({ ok: false, error: 'Gabim serveri' });
      }
    }),
  };
}

module.exports = { buildCrud, bumpVersion, allowedColumns };
