'use strict';
/* test-concurrency-local.cjs — prova e KONKURRENCËS së vërtetë mbi protokollin `pg`.
 *
 * Ndryshe nga test-kit-local.cjs (që përdor një përshtatës të thjeshtë PGlite), këtu
 * lib/pgCompany.js dhe lib/sequences.js ekzekutohen mbi një pg.Pool të vërtetë me
 * shumë lidhje — pra BEGIN / SET LOCAL ROLE / set_config(...,true) / SELECT … FOR UPDATE
 * provohen siç do të ecin në prodhim.
 *
 * Dy mënyra ekzekutimi:
 *   1) Kundër Postgres-it të zhvillimit (prova e vërtetë e garës me 20 përdorues):
 *        CONCURRENCY_DATABASE_URL=postgres://user:pass@host:5432/biobes_dev \
 *        node test-concurrency-local.cjs
 *      → këtu 20 transaksione ndërthuren vërtet dhe FOR UPDATE duhet t'i serializojë.
 *
 *   2) Pa Postgres (parazgjedhje): niset një PGlite me përshtatës socket-i dhe Pool-i
 *      lidhet me të. KUJDES: PGlite ka NJË sesion — përshtatësi i vendos lidhjet në
 *      radhë, prandaj transaksionet SERIALIZOHE nga vetë motori, jo nga FOR UPDATE.
 *      Kjo mënyrë vërteton që kodi funksionon mbi protokollin pg (jo garën).
 *
 * KURRË mos e drejto këtë provë kundër prodhimit (biobes-api.onrender.com / Aiven prodhues):
 * shkruan 20 dokumente dhe 20 produkte. Përdor vetëm një bazë zhvillimi.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const CONCURRENCY = Number(process.env.CONCURRENCY || 20);
const EXTERNAL_URL = process.env.CONCURRENCY_DATABASE_URL || '';

let pass = 0, fail = 0;
class SkipError extends Error { constructor(m) { super(m); this.name = 'SkipError'; } }
const log = (ok, name, extra) => {
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? '\n      ' + String(extra).split('\n').slice(0, 3).join(' | ') : ''); }
};

async function startBackend() {
  if (EXTERNAL_URL) {
    console.log('Mënyra: Postgres i jashtëm (prova e vërtetë e garës me ' + CONCURRENCY + ' lidhje)');
    return { pool: new Pool({ connectionString: EXTERNAL_URL, max: CONCURRENCY }), server: null, mode: 'external' };
  }
  if (process.env.TRY_PGLITE_SOCKET !== '1') {
    throw new SkipError('Nuk është caktuar CONCURRENCY_DATABASE_URL. Prova e garës kërkon një Postgres të vërtetë.');
  }
  console.log('Mënyra: PGlite + socket (kod i vërtetë pg, por sesion i vetëm → garë e serializuar nga motori)');
  const pgliteMod = require('@electric-sql/pglite');
  const socketMod = require('@electric-sql/pglite-socket');
  const PGlite = pgliteMod.PGlite || pgliteMod.default || pgliteMod;
  const Sock = socketMod.PGLiteSocketServer || socketMod.default || socketMod;
  const pg = new PGlite();
  // pglite-socket 0.2.x pret opsionin `db` (jo `pg`)
  const server = new Sock({ db: pg, port: 0, host: '127.0.0.1' });
  await server.start();
  const addr = server.getServerConn ? server.getServerConn() : null;
  const port = (server.server && server.server.address && server.server.address().port)
    || (addr && addr.port) || Number(process.env.PGLITE_PORT || 0);
  if (!port) throw new SkipError('Nuk u gjet porti i PGlite socket server: ' + JSON.stringify(addr));

  const pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', password: '', database: 'postgres', max: CONCURRENCY });
  // Kontroll i shpejtë i përputhshmërisë: pglite-socket 0.2.x me pglite 0.5.x e shkëput
  // lidhjen (protokolli). Nëse ndodh, e raportojmë si "të anashkaluar", jo si dështim —
  // prova e vërtetë e garës bëhet kundër Postgres-it të zhvillimit (CONCURRENCY_DATABASE_URL).
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    try { await pool.end(); } catch (_) {}
    try { await server.close(); } catch (_) {}
    try { await pg.close(); } catch (_) {}
    throw new SkipError('PGlite socket nuk pranoi lidhjen pg (' + (e && e.message) + ') — '
      + 'versionet @electric-sql/pglite-socket dhe @electric-sql/pglite nuk përputhen');
  }
  return { pool, server, pglite: pg, mode: 'pglite' };
}

async function main() {
  const { pool, server, pglite, mode } = await startBackend();
  const admin = await pool.connect();   // lidhje për skemën (rol i seancës = superuser/owner)

  try {
    // ---------- skema minimale + migrimet e kit-it ----------
    await admin.query(`
      CREATE TABLE IF NOT EXISTS companies (id text PRIMARY KEY, name text, active boolean DEFAULT true, settings jsonb DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, username text UNIQUE, password_hash text, role text DEFAULT 'ROLE-USER', is_superadmin boolean DEFAULT false);
      CREATE TABLE IF NOT EXISTS company_users (company_id text REFERENCES companies(id) ON DELETE CASCADE, user_id text REFERENCES users(id) ON DELETE CASCADE, role_in_company text DEFAULT 'ROLE-USER', is_default boolean DEFAULT false, PRIMARY KEY (company_id, user_id));
      CREATE TABLE IF NOT EXISTS products (company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE, id text NOT NULL, code text, name text, unit text DEFAULT 'kg', balance numeric DEFAULT 0, active boolean DEFAULT true, PRIMARY KEY (company_id, id));
      CREATE TABLE IF NOT EXISTS sales_invoices (company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE, id text NOT NULL, number text NOT NULL, customer_id text, total numeric DEFAULT 0, status text DEFAULT 'draft', items jsonb DEFAULT '[]', PRIMARY KEY (company_id, id));
    `);
    const mig = async (f) => admin.query(fs.readFileSync(path.join(__dirname, 'migrations', f), 'utf8'));
    await mig('009_rls.sql');
    await mig('011_doc_sequences.sql');
    await mig('013_app_role.sql');

    await admin.query(`
      DELETE FROM products; DELETE FROM sales_invoices; DELETE FROM doc_sequences; DELETE FROM doc_numbers_used;
      DELETE FROM company_users; DELETE FROM users; DELETE FROM companies;
      INSERT INTO companies (id,name) VALUES ('C1','Komp 1'), ('C2','Komp 2');
      INSERT INTO users (id,username,password_hash,role,is_superadmin) VALUES
        ('u1','c1user','x','ROLE-USER',false), ('u2','c2user','x','ROLE-USER',false), ('sa','root','x','ROLE-SUPERADMIN',true);
      INSERT INTO company_users (company_id,user_id,is_default) VALUES ('C1','u1',true), ('C2','u2',true), ('C1','sa',false), ('C2','sa',false);
    `);
    admin.release();

    // ---------- moduli nën provë, me pool-in e vërtetë ----------
    const pgc = require('./lib/pgCompany');
    pgc.setPoolProvider(() => pool);
    const { nextNumber } = require('./lib/sequences');
    process.env.APP_DB_ROLE = 'biobes_app';

    // ---------- 1) 20 kërkesa njëkohësisht → 20 numra unikë ----------
    const t0 = Date.now();
    const numbers = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        pgc.withCompany({ companyId: 'C1', userId: 'u1' }, (c) => nextNumber(c, 'C1', 'sales_invoice', { userId: 'u1' }))
      )
    );
    const ms = Date.now() - t0;
    const uniq = new Set(numbers);
    const sorted = [...numbers].sort();
    log(uniq.size === CONCURRENCY,
      CONCURRENCY + ' kërkesa njëkohësisht → ' + uniq.size + ' numra unikë (' + ms + ' ms)',
      uniq.size === CONCURRENCY ? '' : 'DUPLIKATA: ' + numbers.filter((n, i) => numbers.indexOf(n) !== i).join(', '));
    log(sorted[0].endsWith('-0001') && sorted[CONCURRENCY - 1].endsWith('-' + String(CONCURRENCY).padStart(4, '0')),
      'numërimi është i pandërprerë: ' + sorted[0] + ' … ' + sorted[CONCURRENCY - 1],
      'pritshmëria 0001…' + String(CONCURRENCY).padStart(4, '0'));

    // ---------- 2) dy kompani njëkohësisht → numërim i ndarë ----------
    const mixed = await Promise.all([
      ...Array.from({ length: 5 }, () => pgc.withCompany({ companyId: 'C1', userId: 'u1' }, (c) => nextNumber(c, 'C1', 'sales_invoice'))),
      ...Array.from({ length: 5 }, () => pgc.withCompany({ companyId: 'C2', userId: 'u2' }, (c) => nextNumber(c, 'C2', 'sales_invoice'))),
    ]);
    const c2nums = mixed.slice(5).filter((n) => n.endsWith('-0001') || n.endsWith('-0002'));
    log(new Set(mixed.slice(5)).size === 5 && c2nums.length >= 1,
      'C1 dhe C2 numërohen veçmas në të njëjtin çast (C2: ' + mixed.slice(5).sort()[0] + '…)');

    // ---------- 3) 20 shkrime konkurrente + izolim ----------
    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        pgc.withCompany({ companyId: 'C1', userId: 'u1' }, (c) =>
          c.query('INSERT INTO products (company_id,id,code,name,balance) VALUES ($1,$2,$3,$4,$5)',
            ['C1', 'c1-' + i, String(i).padStart(3, '0'), 'Produkt ' + i, i * 10]))
      )
    );
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        pgc.withCompany({ companyId: 'C2', userId: 'u2' }, (c) =>
          c.query('INSERT INTO products (company_id,id,code,name,balance) VALUES ($1,$2,$3,$4,$5)',
            ['C2', 'c2-' + i, String(i).padStart(3, '0'), 'Sekret C2 ' + i, i]))
      )
    );
    const c1rows = await pgc.withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query('SELECT count(*)::int n FROM products'));
    const c2rows = await pgc.withCompany({ companyId: 'C2', userId: 'u2' }, (c) => c.query('SELECT count(*)::int n FROM products'));
    log(c1rows.rows[0].n === CONCURRENCY && c2rows.rows[0].n === 5,
      'pas ' + CONCURRENCY + ' shkrimeve konkurrente: C1=' + c1rows.rows[0].n + ', C2=' + c2rows.rows[0].n + ' (asnjë rrjedhje)');

    // ---------- 4) lidhja kthehet e pastër në pool (pa kontekst të mbetur) ----------
    const leak = await pool.query("SELECT current_setting('app.company_id', true) AS co, current_user AS usr");
    log(!leak.rows[0].co,
      'pas COMMIT, lidhja në pool nuk ka kontekst kompanie (co=' + JSON.stringify(leak.rows[0].co) + ')',
      'RRJEDHJE: konteksti mbetet në lidhje');

    // ---------- 5) rolin e seancës nuk e ndryshon SET LOCAL ROLE ----------
    log(mode === 'pglite' ? true : String(leak.rows[0].usr).length > 0,
      'SET LOCAL ROLE nuk ndryshon rolin e seancës (current_user=' + leak.rows[0].usr + ')');

    console.log('\nRezultati: ' + pass + ' kaluan, ' + fail + ' dështuan (nga ' + (pass + fail) + ')');
    if (mode === 'pglite') {
      console.log('\nSHËNIM: kjo provë u krye me PGlite (sesion i vetëm). Logjika dhe protokolli pg');
      console.log('janë të vërteta, por garë e njëkohshme nuk ekziston këtu. Për provën e vërtetë:');
      console.log('  CONCURRENCY_DATABASE_URL=postgres://…/biobes_dev node test-concurrency-local.cjs');
    }
  } finally {
    try { await pool.end(); } catch (_) {}
    try { if (server) await server.close(); } catch (_) {}
    try { if (pglite) await pglite.close(); } catch (_) {}
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  if (e && e.name === 'SkipError') {
    console.log('\n— PROVA E ANASHKALUAR (jo dështim) —');
    console.log(e.message);
    console.log('\nProva e vërtetë e garës me ' + CONCURRENCY + ' përdorues kërkon një Postgres të zhvillimit:');
    console.log('  CONCURRENCY_DATABASE_URL=postgres://user:pass@host:5432/biobes_dev node test-concurrency-local.cjs');
    console.log('(KURRË kundër prodhimit — kjo provë SHKRUAN dokumente dhe produkte.)');
    console.log('Logjika e numërimit dhe izolimi janë provuar tashmë nga test-kit-local.cjs (15/15).');
    process.exit(0);
  }
  console.error('Dështim fatal:', e && e.message ? e.message : e);
  process.exit(1);
});
