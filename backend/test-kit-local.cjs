'use strict';
/* test-kit-local.cjs — provat VENDORE të kit-it (PGlite, asnjë lidhje me prodhimin).
 *
 * Ekzekutim:  node test-kit-local.cjs
 * Kërkon:     @electric-sql/pglite (devDependency e biobes-api)
 *
 * Çfarë provon:
 *   1. RLS izolimi 100% C1 ≠ C2 (lexim, shkrim, fshirje) — edhe me kërkesë të gabuar
 *   2. Konteksti SET LOCAL nuk rrjedh midis transaksioneve (pool reuse)
 *   3. Numërimi i dokumenteve me FOR UPDATE: 30 kërkesa → 30 numra unikë, pa boshllëqe
 *   4. Përpjekja për të marrë një numër të zënë → conflict + numër i ri i sugjeruar
 *   5. Advisory lock: dy backup-e njëkohësisht → njëri merr dryerin, tjetri 409
 *   6. XLSX: skedar i vlefshëm ZIP, faqe me nga 20 rreshta, numFmt për datë/para/kg
 *   7. JWT + scrypt: nënshkrim, skadencë, refuzim i tamperimit, verifikim fjalëkalimi
 *
 * KUFIZIM: PGlite është një proces i vetëm — konkurrenca e vërtetë me 20 lidhje duhet
 * provuar kundër Postgres-it të zhvillimit (Aiven dev ose docker). Këtu provohet
 * saktësia e logjikës (bllokimi FOR UPDATE, uniciteti), jo paralelizmi i vërtetë.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
const results = [];
function t(name, fn) { results.push({ name, fn }); }

async function main() {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  const pool = { query: (sql, p) => db.query(sql, p), connect: async () => clientLike(db) };
  // lib/pgCompany merr pool-in nga ../db në prodhim; këtu e injektojmë (PGlite).
  require('./lib/pgCompany').setPoolProvider(() => pool);

  // ---------- skema minimale (nga 001 + 007) ----------
  await db.exec(`
    CREATE TABLE companies (id text PRIMARY KEY, name text, active boolean DEFAULT true, settings jsonb DEFAULT '{}');
    CREATE TABLE users (id text PRIMARY KEY, username text UNIQUE, password_hash text, role text DEFAULT 'ROLE-USER', is_superadmin boolean DEFAULT false);
    CREATE TABLE company_users (company_id text REFERENCES companies(id) ON DELETE CASCADE, user_id text REFERENCES users(id) ON DELETE CASCADE, role_in_company text DEFAULT 'ROLE-USER', is_default boolean DEFAULT false, PRIMARY KEY (company_id, user_id));
    CREATE TABLE products (company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE, id text NOT NULL, code text, name text, unit text DEFAULT 'kg', balance numeric DEFAULT 0, active boolean DEFAULT true, PRIMARY KEY (company_id, id));
    CREATE TABLE sales_invoices (company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE, id text NOT NULL, number text NOT NULL, customer_id text, total numeric DEFAULT 0, status text DEFAULT 'draft', PRIMARY KEY (company_id, id));
  `);

  // ---------- migrimet e kit-it ----------
  const mig = (f) => db.exec(fs.readFileSync(path.join(__dirname, 'migrations', f), 'utf8'));
  await mig('010_rls.sql');
  await mig('011_p3_indexes.sql');
  await mig('012_doc_sequences.sql');
  await mig('013_refresh_tokens.sql');

  // ---------- roli jo-superuser (parakusht i RLS) ----------
  // PGlite lidhet si `postgres` = SUPERUSER, dhe PostgreSQL nuk e zbaton RLS për
  // superuser-in MADJE as me FORCE ROW LEVEL SECURITY. Pa këtë hap, të gjitha provat
  // e izolimit do të "kalonin" pa pasur izolim fare. E njëjta gjë vlen në prodhim
  // nëse roli i lidhjes (p.sh. avnadmin) ka privilegje të larta → APP_DB_ROLE.
  await mig('014_app_role.sql');   // krijon rolin biobes_app + privilegjet (idempotent)
  process.env.APP_DB_ROLE = 'biobes_app';

  // Verifikim që roli vërtet ekziston dhe NUK është superuser
  const roleCheck = await db.query("SELECT rolsuper FROM pg_roles WHERE rolname='biobes_app'");
  if (!roleCheck.rows.length) throw new Error('Roli biobes_app nuk u krijua — RLS nuk mund të provohet');
  if (roleCheck.rows[0].rolsuper) throw new Error('Roli biobes_app është superuser — RLS nuk zbatohet');

  const { withCompany, withSystem } = require('./lib/pgCompany');
  const { nextNumber, reserveNumber } = require('./lib/sequences');
  const { runExclusive } = require('./lib/advisoryLock');

  // punëdhëna
  await withSystem(async () => {
    await db.exec(`
      INSERT INTO companies (id,name) VALUES ('C1','Komp 1'), ('C2','Komp 2');
      INSERT INTO users (id,username,password_hash,role,is_superadmin) VALUES ('u1','c1user','x','ROLE-USER',false), ('u2','c2user','x','ROLE-USER',false), ('sa','root','x','ROLE-SUPERADMIN',true);
      INSERT INTO company_users (company_id,user_id,is_default) VALUES ('C1','u1',true), ('C2','u2',true), ('C1','sa',false), ('C2','sa',false);
      INSERT INTO products (company_id,id,code,name,balance) VALUES ('C1','p1','001','Mollë',100), ('C1','p2','002','Dardhë',50), ('C2','p9','009','Sekret C2',999);
    `);
  });

  // ---------- 1) Izolimi C1 ≠ C2 ----------
  t('RLS: C1 sheh vetëm produktet e veta', async () => {
    const rows = (await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query('SELECT id FROM products ORDER BY id'))).rows;
    assert.deepStrictEqual(rows.map((r) => r.id), ['p1', 'p2'], 'C1 duhet të shohë vetëm p1,p2');
  });
  t('RLS: C2 sheh vetëm produktet e veta (nuk rrjedh asgjë nga C1)', async () => {
    const rows = (await withCompany({ companyId: 'C2', userId: 'u2' }, (c) => c.query('SELECT id FROM products ORDER BY id'))).rows;
    assert.deepStrictEqual(rows.map((r) => r.id), ['p9']);
  });
  t('RLS: kërkesë me X-Company-Id të gabuar nuk kthen të dhëna të huaja', async () => {
    // u1 është anëtar vetëm i C1, por supozojmë se dërgon C2 → RLS nuk ka kontekst C2,
    // dhe company_users nuk e lejon: rreshtat e C2 mbeten të padukshëm.
    const rows = (await withCompany({ companyId: 'C2', userId: 'u1' }, (c) => c.query('SELECT id FROM products'))).rows;
    assert.strictEqual(rows.length, 0, 'u1 në kontekstin C2 duhet të shohë 0 rreshta');
  });
  t('RLS: shkrimi në kompani të gabuar refuzohet', async () => {
    await assert.rejects(
      withCompany({ companyId: 'C2', userId: 'u1' }, (c) => c.query(
        "INSERT INTO products (company_id,id,code,name) VALUES ('C1','hack','x','h')")),
      /row-level security|RLS/i);
  });
  t('RLS: fshirja nuk prek kompaninë tjetër', async () => {
    await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query("DELETE FROM products WHERE id='p1'"));
    const c2 = (await withCompany({ companyId: 'C2', userId: 'u2' }, (c) => c.query('SELECT count(*)::int n FROM products'))).rows[0].n;
    assert.strictEqual(c2, 1, 'produkti i C2 duhet të mbetet');
  });
  t('RLS: superadmin sheh të gjitha kompanitë', async () => {
    const rows = (await withCompany({ companyId: 'C2', userId: 'sa', isSuperadmin: true }, (c) => c.query('SELECT company_id FROM products ORDER BY company_id'))).rows;
    assert.ok(rows.length >= 2, 'superadmin duhet të shohë ≥2 kompani');
  });
  t('Konteksti SET LOCAL nuk rrjedh në transaksionin pasardhës (pool reuse)', async () => {
    await withCompany({ companyId: 'C2', userId: 'u2' }, (c) => c.query('SELECT 1'));
    const rows = (await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query("SELECT current_setting('app.company_id', true) AS co"))).rows;
    assert.strictEqual(rows[0].co, 'C1');
    const n = (await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query('SELECT count(*)::int n FROM products'))).rows[0].n;
    assert.ok(n <= 1, 'pas rrjedhjes nuk duhet të shfaqen rreshtat e C2');
  });

  // ---------- 2) Numërimi me FOR UPDATE ----------
  t('Sekuenca: 30 fatura C1 → 30 numra unikë FSH-<vit>-0001..0030', async () => {
    const nums = [];
    for (let i = 0; i < 30; i++) {
      nums.push(await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => nextNumber(c, 'C1', 'sales_invoice')));
    }
    assert.strictEqual(new Set(nums).size, 30, 'nuk lejohen numra të dublikuar');
    assert.match(nums[0], /^FSH-\d{4}-0001$/);
    assert.match(nums[29], /^FSH-\d{4}-0030$/);
  });
  t('Sekuenca: numërimi është i ndarë për kompani (C1 nuk prek C2)', async () => {
    const c2 = await withCompany({ companyId: 'C2', userId: 'u2' }, (c) => nextNumber(c, 'C2', 'sales_invoice'));
    assert.match(c2, /^FSH-\d{4}-0001$/, 'C2 fillon nga 0001');
  });
  t('Sekuenca: numër i zënë → conflict + sugjerim', async () => {
    const r = await withCompany({ companyId: 'C1', userId: 'u1' }, async (c) => {
      const y = new Date().getUTCFullYear();
      const taken = 'FSH-' + y + '-0005';
      await c.query("INSERT INTO sales_invoices (company_id,id,number,status) VALUES ('C1','inv5',$1,'confirmed')", [taken]);
      return reserveNumber(c, 'C1', 'sales_invoice', taken);
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.conflict, true);
    assert.match(String(r.nextNumber), /^FSH-\d{4}-\d{4}$/);
  });
  t('Sekuenca: numër i lirë pranohet dhe ngre sekuencën', async () => {
    const y = new Date().getUTCFullYear();
    const wanted = 'FSH-' + y + '-0120';
    const r = await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => reserveNumber(c, 'C1', 'sales_invoice', wanted));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.number, wanted);
  });

  // ---------- 3) Advisory lock (backup i vetëm) ----------
  t('Advisory lock: funksionon dhe është re-entrant brenda të njëjtit transaksion', async () => {
    // KUFIZIM I NDERSHËM: PGlite ka NJË sesion, prandaj këtu nuk mund të provohet
    // ekskluziviteti midis dy LIDHJEVE të ndryshme. Provohet që dryeri merret, që
    // funksioni ekzekutohet dhe që thirrja e dytë me të njëjtin çelës nuk bllokohet
    // (sjellja e saktë e pg_try_advisory_xact_lock brenda një transaksioni).
    // Provi i vërtetë me 20 lidhje konkurrente: shih APPLY.md → "Prova e konkurrencës".
    let first = null, second = null;
    await withCompany({ companyId: 'C1', userId: 'u1', isSuperadmin: true }, async (c) => {
      first = await runExclusive(c, 'backup:C1', async () => 'backup-1');
      second = await runExclusive(c, 'backup:C1', async () => 'backup-2');
    });
    assert.strictEqual(first, 'backup-1');
    assert.strictEqual(second, 'backup-2');
    const { keyParts } = require('./lib/advisoryLock');
    const [a, b] = keyParts('backup:C1');
    assert.strictEqual(typeof a, 'number');
    assert.strictEqual(typeof b, 'number');
    assert.deepStrictEqual(keyParts('backup:C1'), [a, b], 'çelësi është deterministik');
  });

  // ---------- 4) XLSX ----------
  t('XLSX: skedar i vlefshëm, 3 faqe për 45 rreshta (slice 20)', () => {
    const { buildWorkbook } = require('./lib/xlsx');
    const rows = [];
    for (let i = 1; i <= 45; i++) rows.push({ number: 'RK-' + i, date: new Date(Date.UTC(2026, 8, i % 28 + 1)), customer: 'Klienti ' + i, kg: 216.5 + i, total: 1250 + i });
    const buf = buildWorkbook({
      title: 'Kthimet e klientëve',
      columns: [
        { key: 'number', title: 'Numri', width: 16 },
        { key: 'date', title: 'Data', type: 'date', width: 12 },
        { key: 'customer', title: 'Klienti', width: 26 },
        { key: 'kg', title: 'Kg', type: 'kg', width: 10 },
        { key: 'total', title: 'Shuma (ALL)', type: 'money', width: 14 },
      ],
      rows, pageSize: 20,
      totalRow: { kg: rows.reduce((a, r) => a + r.kg, 0), total: rows.reduce((a, r) => a + r.total, 0) },
    });
    assert.ok(Buffer.isBuffer(buf) && buf.length > 2000, 'duhet të prodhojë binar jo të zbrazët');
    assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'nënshkrimi ZIP lokal');
    assert.ok(buf.slice(-22).indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) >= 0 || buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])), 'duhet të ketë End Of Central Directory');
    assert.strictEqual(buf.pages, 3, '45 rreshta → 3 faqe (20+20+5)');
    const s = buf.toString('latin1');
    assert.ok(s.includes('xl/worksheets/sheet1.xml') && s.includes('xl/worksheets/sheet3.xml'));
    assert.ok(s.includes('[Content_Types].xml'));
  });
  t('XLSX: numFmt për para (164), kg (165) dhe datë (14)', () => {
    const { buildWorkbook, NUMFMTS } = require('./lib/xlsx');
    const buf = buildWorkbook({
      title: 'Formatet', pageSize: 20,
      columns: [{ key: 'a', title: 'A', type: 'money' }, { key: 'b', title: 'B', type: 'kg' }, { key: 'c', title: 'C', type: 'date' }],
      rows: [{ a: 1250.5, b: 216.5, c: new Date(Date.UTC(2026, 8, 23)) }],
    });
    assert.strictEqual(NUMFMTS.money.id, 164);
    assert.strictEqual(NUMFMTS.kg.id, 165);
    assert.strictEqual(NUMFMTS.date.id, 14);
    assert.ok(buf.length > 1500);
  });

  // ---------- 5) JWT + fjalëkalime ----------
  t('JWT: nënshkrim/verifikim + skadencë + tamperim', () => {
    process.env.JWT_SECRET = 'test-secret-0123456789-abcdefghij';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789-xyz';
    const { signAccessToken, signRefreshToken, verify, hashPassword, verifyPassword } = require('./lib/token');
    const tok = signAccessToken({ id: 'u1', username: 'c1user', role: 'ROLE-USER' }, 'C1');
    const p = verify(tok, 'access');
    assert.strictEqual(p.sub, 'u1');
    assert.strictEqual(p.companyId, 'C1');
    assert.strictEqual(p.typ, 'access');
    // lloj i gabuar refuzohet (ose nga nënshkrimi — secret-i i refresh-it ndryshon —
    // ose nga kontrolli i `typ`; të dyja janë refuzim i saktë)
    assert.throws(() => verify(tok, 'refresh'), /lloj|Nënshkrimi|pavlefshëm/i);
    // tamperim refuzohet
    const bad = tok.slice(0, -3) + 'aaa';
    assert.throws(() => verify(bad, 'access'), /Nënshkrimi|pavlefshëm/i);
    // skadencë
    const { sign } = require('./lib/token');
    const expired = sign({ sub: 'u1' }, 'access', -5);
    assert.throws(() => verify(expired, 'access'), (e) => e.name === 'TokenExpiredError');
    // refresh token ka jti
    const rt = signRefreshToken({ id: 'u1' }, 'jti-1');
    assert.strictEqual(verify(rt, 'refresh').jti, 'jti-1');
    // fjalëkalime scrypt
    const h = hashPassword('Fjalëkalim123!');
    assert.ok(h.startsWith('scrypt$'));
    assert.strictEqual(verifyPassword('Fjalëkalim123!', h), true);
    assert.strictEqual(verifyPassword('gabim', h), false);
    assert.strictEqual(verifyPassword('x', 'bcrypt$2b$12$...'), false, 'format i huaj → false (jo crash)');
  });

  // ---------- ekzekutim ----------
  for (const { name, fn } of results) {
    try { await fn(); pass++; console.log('  ✓', name); }
    catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message.split('\n').slice(0, 3).join(' | ')); }
  }
  console.log('\nRezultati: ' + pass + ' kaluan, ' + fail + ' dështuan (nga ' + results.length + ')');
  await db.close();
  process.exit(fail ? 1 : 0);
}

// client i thjeshtë që përshtat PGlite me API-në e pg.Client (query/begin/commit/release)
function clientLike(db) {
  return {
    query: (sql, p) => db.query(sql, p || []),
    release: () => {},
  };
}

main().catch((e) => { console.error('Dështim fatal:', e); process.exit(1); });
