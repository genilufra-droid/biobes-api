// BioBes API — Postgres pool (Aiven-ready) + krijim idempotent i skemës.
const { Pool } = require('pg');

let pool = null;

function sslConfig() {
  // Aiven kërkon SSL. Nëse jepet CA (PG_CA_CERT), certifikata verifikohet;
  // ndryshe lidhja enkriptohet pa verifikim (mjafton për MVP).
  if (process.env.PG_CA_CERT) return { ca: String(process.env.PG_CA_CERT).replace(/\\n/g, '\n') };
  const mode = (process.env.PGSSLMODE || '').toLowerCase();
  const url = process.env.DATABASE_URL || '';
  if (mode === 'require' || mode === 'prefer' || /aiven/i.test(url)) return { rejectUnauthorized: false };
  return undefined; // Postgres lokal pa SSL
}

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslConfig(), max: 10, idleTimeoutMillis: 30000 });
    pool.on('error', (e) => console.error('[db] pool error:', e.message));
  }
  return pool;
}

async function dbOk() {
  const p = getPool();
  if (!p) return false;
  try { await p.query('SELECT 1'); return true; }
  catch (e) { console.error('[db] unreachable:', e.message); return false; }
}

module.exports = { getPool, dbOk };
