// BioBes API — migrime me versione: aplikohen vetëm file-t e rinj, secili
// brenda transaksionit. Nuk humbasin të dhëna (migrimet përdorin IF NOT EXISTS
// dhe ADD COLUMN IF NOT EXISTS). Për ndryshim të ri: shto migrations/NNN_.sql.
const fs = require('fs');
const path = require('path');
const { getPool } = require('./db');

async function migrate() {
  const p = getPool();
  if (!p) { console.log('[db] DATABASE_URL mungon — serveri niset pa databazë (vetëm /api/health).'); return false; }
  await p.query('CREATE TABLE IF NOT EXISTS schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  const { rows } = await p.query('SELECT filename FROM schema_migrations');
  const done = new Set(rows.map((r) => r.filename));
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    console.log('[db] migrim: ' + f);
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [f]);
      await client.query('COMMIT');
      console.log('[db] u aplikua: ' + f);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* bosh */ }
      throw e;
    } finally {
      client.release();
    }
  }
  console.log('[db] schema gati.');
  return true;
}

module.exports = { migrate };
