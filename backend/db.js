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
      max: Math.max(1, Number(process.env.POOL_MAX || 10)),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', (e) => console.error('[db] pool error:', e.message));
    // Një pengesë e shkurtër e databazës nuk duhet të bllokojë kërkesat pafund:
    // presim deri në 10 s për një lidhje, pastaj dështojmë shpejt (dhe klienti riprovojn).
    pool.options = pool.options || {};
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

// Ekzekuton një bllok pune Brenda një transaksioni me kontekstin e kompanisë
// të vendosur në nivel sesioni-transaksioni (set_config(..., true) = SET LOCAL).
//
// Kjo është çelësi i RLS-së (migrimi 010): politikat e izolimit lexojnë
// current_setting('app.company_id'), kështu që brenda këtij blloku Postgres-i
// refuzon vetë çdo rresht që s'i përket kompanisë — edhe sikur kodi të harrojë
// filtrin WHERE.
async function withCompany(companyId, fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Kompani bosh → kontekst NULL (politikat RLS e lejojnë, si rrugët e vjetra);
    // kompani e vendosur → vetëm rreshtat e saj kalojnë.
    await client.query("SELECT set_config('app.company_id', $1, true)", [companyId ? String(companyId) : null]);
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

// Mbyll pool-in e lidhjeve (mbyllje e butë e serverit).
async function closePool() {
  if (!pool) return;
  try { await pool.end(); } catch (e) { console.error('[db] close:', e.message); }
  pool = null;
}

module.exports = { getPool, dbOk, closePool, withCompany };
