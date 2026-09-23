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
// të vendosur në nivel sesioni-transaksioni.
//
// Ky funksion është pika e vetme e kontekstit për të gjithë kodin e CRUD-it.
// Të dyja shenjat pranohen:
//   withCompany('C1', fn)                                  — vetëm kompania
//   withCompany({ companyId, userId, isSuperadmin }, fn)   — kontekst i plotë
// dhe delegon në lib/pgCompany.js, i cili veç kompanisë vendos edhe
// `app.user_id`, `app.is_superadmin` dhe `SET LOCAL ROLE` kur është caktuar
// APP_DB_ROLE — pa këto, politikat RLS (010_rls + 015) nuk e njohin përdoruesin.
async function withCompany(companyOrCtx, fn) {
  const pg = require('./lib/pgCompany');
  const ctx = (companyOrCtx && typeof companyOrCtx === 'object')
    ? companyOrCtx
    : { companyId: companyOrCtx };
  return pg.withCompany(ctx, fn);
}

// Mbyll pool-in e lidhjeve (mbyllje e butë e serverit).
async function closePool() {
  if (!pool) return;
  try { await pool.end(); } catch (e) { console.error('[db] close:', e.message); }
  pool = null;
}

module.exports = { getPool, dbOk, closePool, withCompany };
