// Test lokale multi-company (Modeli B): server.js real + Postgres i vërtetë (PGlite) nëpërmjet TCP.
// Verifikon: (1) pajtueshmërinë e plotë me klientin e vjetër (pa `company`), (2) ndarjen
// e gjendjes per kompani, (3) kontrollin e anëtarësisë (403), (4) versionet e ndara,
// (5) wipe-in per kompani, (6) backup/restore per kompani me mbrojtjen kundër kalimit
// nga një kompani në tjetrën, (7) migrimin idempotent të skemës 008.
const { spawn } = require('child_process');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const DB_PORT = 5435;
const API_PORT = 3202;
const API = `http://127.0.0.1:${API_PORT}`;
const ADMIN = 'admin';
const PASS = 'admin12345';
const MAG = 'magazineri';
const MAG_PASS = 'magazina12345';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Gjendje minimale e vlefshme për serverin (validateState kërkon ≥3 fusha të njohura).
const mkState = (tag) => ({
  products: [{ id: 'P-' + tag, code: 'P' + tag, name: 'Mall ' + tag }],
  suppliers: [{ id: 'S-' + tag, code: 'S' + tag, name: 'Furnitor ' + tag }],
  customers: [{ id: 'C-' + tag, code: 'C' + tag, name: 'Klient ' + tag }],
  lots: [],
});

(async () => {
  const db = new PGlite();
  const srv = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1', maxConnections: 8 });
  await srv.start();
  console.log('[mc] DB wire në 127.0.0.1:' + DB_PORT);

  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DATABASE_URL: `postgres://biobes:biobes@127.0.0.1:${DB_PORT}/biobes`,
      ADMIN_USERNAME: ADMIN,
      ADMIN_PASSWORD: PASS,
      SESSION_TTL_HOURS: '24',
      PGSSLMODE: 'disable',
      DEFAULT_COMPANY: 'C1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d; });
  child.stderr.on('data', (d) => { serverLog += d; });

  const call = async (p, opts = {}) => {
    const r = await fetch(API + p, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    return { status: r.status, ok: r.ok, data: await r.json().catch(() => ({})) };
  };
  const login = async (u, pw) => call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: pw }) });
  const put = (h, state, extra = {}) => call('/api/state', { method: 'PUT', headers: h, body: JSON.stringify({ state, ...extra }) });
  const get = (h, company) => call('/api/state' + (company ? '?company=' + company : ''), { headers: h });

  try {
    // === Nisja ===
    let health = null;
    for (let i = 0; i < 60; i++) {
      try { health = await call('/api/health'); if (health.ok) break; } catch (_) {}
      await sleep(500);
    }
    ok('server-booted', health && health.ok && health.data.db === true, JSON.stringify(health && health.data));
    ok('migrimi-008-u-aplikua', !!(health && health.data.companies >= 1), 'kompani=' + (health && health.data.companies));
    ok('kompania-e-parazgjedhur=C1', !!(health && health.data.defaultCompany === 'C1'));

    const A = await login(ADMIN, PASS);
    ok('admin-login', A.ok && !!A.data.token);
    if (!A.ok) { console.log(serverLog); process.exit(1); }
    const HA = { Authorization: 'Bearer ' + A.data.token };

    // === 1) Pajtueshmëria me klientin e vjetër (pa `company`) ===
    ok('veteranisht: login-i shpall një kompani (multiCompany=false)', A.data.multiCompany === false && Array.isArray(A.data.companies) && A.data.companies.length === 1 && A.data.companies[0].id === 'C1', JSON.stringify(A.data.companies));
    const st1 = Object.assign(mkState('ALPHA'), { settings: { companyName: 'BioBes' } });
    const s1 = await put(HA, st1);
    ok('veteranisht: PUT pa company → version 1', s1.ok && s1.data.version === 1, JSON.stringify(s1.data));
    const g1 = await get(HA);
    ok('veteranisht: GET pa company → gjendja e C1', g1.ok && g1.data.state && g1.data.state.products[0].id === 'P-ALPHA' && g1.data.company === 'C1');
    const v1 = await call('/api/state/version', { headers: HA });
    ok('veteranisht: version pa company = 1', v1.ok && v1.data.version === 1, JSON.stringify(v1.data));

    // === 2) Kompania e dytë ===
    const c2 = await call('/api/admin/companies', { method: 'POST', headers: HA, body: JSON.stringify({ code: 'XX', name: 'Kompania Dytë', nipt: 'L22222222A', city: 'Durrës' }) });
    ok('krijohet kompania e dytë', c2.ok && c2.data.company && c2.data.company.id === 'C2', JSON.stringify(c2.data.company && c2.data.company.id));
    const me2 = await call('/api/auth/me', { headers: HA });
    ok('multiCompany=true pas dy kompanive', me2.ok && me2.data.multiCompany === true && me2.data.companies.length === 2);
    const g2 = await get(HA, 'C2');
    ok('C2 është bosh (state null, version 0)', g2.ok && g2.data.state === null && g2.data.version === 0);
    const s2 = await put(HA, mkState('BETA'), { company: 'C2' });
    ok('PUT në C2 → version 1', s2.ok && s2.data.version === 1 && s2.data.company === 'C2', JSON.stringify(s2.data));
    const g1b = await get(HA, 'C1');
    ok('C1 e paprekur nga puna në C2', g1b.ok && g1b.data.state.products[0].id === 'P-ALPHA' && g1b.data.version === 1);

    // === 3) Versionet e ndara (CAS per kompani) ===
    const s1b = await put(HA, mkState('ALPHA2'), { baseVersion: 1, company: 'C1' });
    ok('CAS në C1 me baseVersion 1 → version 2', s1b.ok && s1b.data.version === 2);
    const s1c = await put(HA, mkState('ALPHA3'), { baseVersion: 1, company: 'C1' });
    ok('CAS me version të vjetër → 409 konflikt', s1c.status === 409, 'status=' + s1c.status);
    const s2b = await put(HA, mkState('BETA2'), { baseVersion: 1, company: 'C2' });
    ok('CAS në C2 vazhdon në mënyrë të pavarur → version 2', s2b.ok && s2b.data.version === 2);

    // === 4) Anëtarësia: përdorues i C1 nuk e hap C2 ===
    const nu = await call('/api/admin/users', { method: 'POST', headers: HA, body: JSON.stringify({ username: MAG, password: MAG_PASS, name: 'Magazineri', role: 'ROLE-USER' }) });
    ok('krijohet përdoruesi i magazinës', nu.ok, JSON.stringify(nu.data).slice(0, 120));
    const uid = (nu.data.user && nu.data.user.id) || (nu.data.users && nu.data.users.find((u) => u.username === MAG) || {}).id;
    const mem1 = await call('/api/admin/users/' + uid + '/companies', { method: 'PUT', headers: HA, body: JSON.stringify({ companies: [{ id: 'C1', isDefault: true }] }) });
    ok('anëtarësia: vetëm C1', mem1.ok && mem1.data.membership.length === 1 && mem1.data.membership[0].id === 'C1', JSON.stringify(mem1.data.membership));
    const M = await login(MAG, MAG_PASS);
    ok('login i përdoruesit të magazinës', M.ok && !!M.data.token);
    ok('multiCompany për magazinerin = false (një kompani)', M.data.multiCompany === false && M.data.companies.length === 1);
    const HM = { Authorization: 'Bearer ' + M.data.token };
    const mgC1 = await get(HM, 'C1');
    ok('magazineri lexon C1', mgC1.ok && mgC1.data.state.products[0].id === 'P-ALPHA2');
    const mgC2 = await get(HM, 'C2');
    ok('magazineri NUK lexon C2 → 403', mgC2.status === 403, 'status=' + mgC2.status);
    const mgC2w = await put(HM, mkState('HACK'), { company: 'C2' });
    ok('magazineri NUK shkruan në C2 → 403', mgC2w.status === 403, 'status=' + mgC2w.status);
    const mgVersion = await call('/api/state/version?company=C2', { headers: HM });
    ok('magazineri NUK lexon versionin e C2 → 403', mgVersion.status === 403);
    const mgBogus = await get(HM, 'C9');
    ok('kompani e panjohur → 404', mgBogus.status === 404, 'status=' + mgBogus.status);
    const mgDef = await get(HM);
    ok('pa company → magazineri bie në kompaninë e tij (C1)', mgDef.ok && mgDef.data.company === 'C1');

    // Anëtarësia mund të shtohet → qasja hapet
    await call('/api/admin/users/' + uid + '/companies', { method: 'PUT', headers: HA, body: JSON.stringify({ companies: [{ id: 'C1' }, { id: 'C2', isDefault: true }] }) });
    const mgC2b = await get(HM, 'C2');
    ok('pas shtimit në anëtarësi, magazineri lexon C2', mgC2b.ok && mgC2b.data.company === 'C2');
    const mgDef2 = await get(HM);
    ok('kompania e parazgjedhur e magazinerit u bë C2', mgDef2.ok && mgDef2.data.company === 'C2');
    // Kthehu vetëm në C1 për hapat vijues
    await call('/api/admin/users/' + uid + '/companies', { method: 'PUT', headers: HA, body: JSON.stringify({ companies: ['C1'] }) });
    const mgC2c = await get(HM, 'C2');
    ok('heqja nga anëtarësia e mbyll përsëri C2 → 403', mgC2c.status === 403);

    // === 5) Backup-et per kompani ===
    const b1 = await call('/api/backups', { method: 'POST', headers: HA, body: JSON.stringify({ company: 'C1', label: 'C1-test' }) });
    ok('backup i C1', b1.ok && b1.data.company === 'C1');
    const b2 = await call('/api/backups', { method: 'POST', headers: HA, body: JSON.stringify({ company: 'C2', label: 'C2-test' }) });
    ok('backup i C2', b2.ok && b2.data.company === 'C2');
    const lb = await call('/api/backups?company=C2', { headers: HA });
    ok('lista e backup-eve filtrohet per kompani', lb.ok && lb.data.backups.length >= 1 && lb.data.backups.every((x) => (x.company_id || 'C1') === 'C2'), JSON.stringify(lb.data.backups.map((x) => x.company_id)));
    const bad = await call('/api/backups/' + b2.data.id + '/restore', { method: 'POST', headers: HA, body: JSON.stringify({ company: 'C1' }) });
    ok('rikthimi i backup-it të C2 mbi C1 REFUZOHET', bad.status === 400, 'status=' + bad.status + ' ' + JSON.stringify(bad.data).slice(0, 80));
    await put(HA, mkState('C1-TJETER'), { company: 'C1' });
    const good = await call('/api/backups/' + b1.data.id + '/restore', { method: 'POST', headers: HA, body: JSON.stringify({ company: 'C1' }) });
    ok('rikthimi i backup-it të C1 mbi C1 pranohet', good.ok && good.data.company === 'C1', JSON.stringify(good.data));
    const g1c = await get(HA, 'C1');
    ok('gjendja e C1 u rikthye nga backup-i', g1c.ok && g1c.data.state.products[0].id === 'P-ALPHA2');
    const g2c = await get(HA, 'C2');
    ok('C2 nuk u prek nga rikthimi i C1', g2c.ok && g2c.data.state.products[0].id === 'P-BETA2');

    // === 6) Wipe per kompani ===
    const w2 = await call('/api/admin/wipe', { method: 'POST', body: JSON.stringify({ password: PASS, company: 'C2' }) });
    ok('wipe i C2 pranohet', w2.ok && w2.data.company === 'C2' && !!w2.data.wipedAt, JSON.stringify(w2.data));
    const g2d = await get(HA, 'C2');
    ok('C2 u fshi + shenja e wipe-it', g2d.ok && g2d.data.state === null && !!g2d.data.wipedAt);
    const g1d = await get(HA, 'C1');
    ok('C1 NUK u prek nga wipe-i i C2', g1d.ok && !!g1d.data.state && !g1d.data.wipedAt);
    const s2no = await put(HA, mkState('PA-ACK'), { company: 'C2' });
    ok('PUT në C2 pa pranimin e wipe-it refuzohet (409 wiped)', s2no.status === 409 && s2no.data.wiped === true, 'status=' + s2no.status);
    const s2c = await put(HA, mkState('RIFILLIM'), { company: 'C2', wipeAck: g2d.data.wipedAt });
    ok('C2 rifillon pastër pasi pranon wipe-in (version 1)', s2c.ok && s2c.data.version === 1 && s2c.data.company === 'C2', JSON.stringify(s2c.data));
    const g2e = await get(HA, 'C2');
    ok('shenja e wipe-it hiqet pas rifillimit', g2e.ok && !g2e.data.wipedAt);

    // === 7) Migrimi: idempotent + kopja e sigurisë ===
    const { migrate } = require('./migrate');
    const before = await db.query("SELECT id,company_id,version FROM app_state ORDER BY id");
    await db.exec(require('fs').readFileSync(path.join(__dirname, 'migrations', '008_companies.sql'), 'utf8'));
    const after = await db.query("SELECT id,company_id,version FROM app_state ORDER BY id");
    ok('migrimi 008 është idempotent (gjendja nuk ndryshon)', JSON.stringify(before.rows) === JSON.stringify(after.rows), JSON.stringify(after.rows));
    const bak = await db.query('SELECT COUNT(*)::int c FROM app_state_bak_008');
    ok('kopja e sigurisë app_state_bak_008 ekziston', bak.rows[0].c >= 0);
    const wipeKeys = await db.query("SELECT key FROM meta WHERE key LIKE 'wiped_at%' ORDER BY key");
    ok('shenja e wipe-it është per kompani (pa shenjë për C1)', wipeKeys.rows.every((r) => r.key === 'wiped_at:C2'), JSON.stringify(wipeKeys.rows.map((r) => r.key)));
    const uc = await db.query('SELECT COUNT(*)::int c FROM user_companies');
    ok('anëtarësia është regjistruar', uc.rows[0].c >= 2, 'rreshta=' + uc.rows[0].c);

    // === 8) Auditimi per kompani ===
    const aud = await call('/api/audit?company=C2&limit=50', { headers: HA });
    ok('auditimi filtrohet per kompani', aud.ok && Array.isArray(aud.data.rows) && aud.data.rows.some((r) => r.action === 'WIPE'));

    ok('pa gabime në logun e serverit', !/\[fatal\]|UnhandledPromiseRejection/.test(serverLog), serverLog.split('\n').filter((l) => /\[fatal\]/.test(l))[0] || '');
  } catch (e) {
    fail++;
    console.log('FAIL: ' + e.message);
    console.log(serverLog.slice(-2000));
  }

  console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
  try { child.kill(); } catch (_) {}
  try { await db.close(); } catch (_) {}
  process.exit(fail ? 1 : 0);
})();
