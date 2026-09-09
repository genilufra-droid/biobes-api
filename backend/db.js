// BioBes API — Postgres pool (Aiven-ready) + krijim idempotent i skemës.
const { Pool } = require('pg');

let pool = null;

function sslConfig() {
  // Aiven kërkon SSL. Nëse jepet CA (PG_CA_CERT), certifikata verifikohet;
  // ndryshe lidhja enkriptohet pa verifikim të zinxhirit (MVP/pilot).
  if (process.env.PG_CA_CERT) {
    return {
      ca: String(process.env.PG_CA_CERT).replace(/\\n/g, '\n'),
      rejectUnauthorized: true,
    };
  }

  const mode = (process.env.PGSSLMODE || '').toLowerCase();
  const url = process.env.DATABASE_URL || '';
  if (mode === 'require' || mode === 'prefer' || /aiven/i.test(url)) {
    return { rejectUnauthorized: false };
  }
  return undefined; // Postgres lokal pa SSL
}

function sanitizedConnectionString() {
  const raw = process.env.DATABASE_URL || '';
  if (!raw) return raw;

  // pg-connection-string mund ta mbishkruajë objektin `ssl` kur DATABASE_URL
  // përmban sslmode/sslrootcert/sslcert/sslkey. Në Render + Aiven kjo mund të
  // shkaktojë "self-signed certificate in certificate chain" edhe kur
  // rejectUnauthorized:false është vendosur më sipër. Heqim vetëm parametrat
  // SSL nga URI dhe SSL-në e kontrollojmë eksplicitisht te Pool config.
  try {
    const u = new URL(raw);
    ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch (_) {
    return raw;
  }
}

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: sanitizedConnectionString(),
      ssl: sslConfig(),
      max: 10,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (e) => console.error('[db] pool error:', e.message));
  }
  return pool;
}

async function dbOk() {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query('SELECT 1');
    return true;
  } catch (e) {
    console.error('[db] unreachable:', e.message);
    return false;
  }
}

module.exports = { getPool, dbOk };
