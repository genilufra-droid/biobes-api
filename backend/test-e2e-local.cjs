// E2E lokale: server.js real + Postgres i vërtetë (PGlite) nëpërmjet TCP.
// Verifikon izolimin e moduleve (skema Odoo) nga fundi në fund.
const { spawn } = require('child_process');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const DB_PORT = 5433;
const API_PORT = 3200;
const API = `http://127.0.0.1:${API_PORT}`;
const ADMIN = 'admin';
const PASS = 'admin12345';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = new PGlite();
  const srv = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1', maxConnections: 8 });
  await srv.start();
  console.log('[e2e] DB wire në 127.0.0.1:' + DB_PORT);

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

  // Prisni boot-in.
  let health = null;
  for (let i = 0; i < 60; i++) {
    try { health = await call('/api/health'); if (health.ok) break; } catch (_) {}
    await sleep(500);
  }
  ok('server-booted', health && health.ok && health.data.db === true, JSON.stringify(health && health.data));

  const A = await login(ADMIN, PASS);
  ok('admin-login', A.ok && !!A.data.token);
  if (!A.ok) { console.log(serverLog); process.exit(1); }
  const HA = { Authorization: 'Bearer ' + A.data.token };
  ok('admin-modules-null', A.data.modules === null || A.data.modules === undefined);

  // Admini sheh modulet/grupet.
  const mods = await call('/api/access/modules', { headers: HA });
  ok('modules-list', mods.ok && mods.data.modules.length === 5, JSON.stringify((mods.data.modules || []).map((m) => m.id)));

  // Krijo shitës me GRP-SAL-USER.
  const created = await call('/api/admin/users', { method: 'POST', headers: HA, body: JSON.stringify({ username: 'sal', password: 'salsecret1', name: 'Shitesi', role: 'ROLE-USER', groups: ['GRP-SAL-USER'] }) });
  ok('create-sal', created.ok && created.data.user && created.data.user.groups.length >= 1, JSON.stringify(created.data));
  const salId = created.ok ? created.data.user.id : null;

  // Krijo përdorues pa asnjë grup.
  const none = await call('/api/admin/users', { method: 'POST', headers: HA, body: JSON.stringify({ username: 'none', password: 'nonesecret1', name: 'Pa grup', role: 'ROLE-USER', groups: [] }) });
  ok('create-none', none.ok && (none.data.user.groups || []).length === 0);

  // Admini shkruan gjendjen e plotë (12 fusha).
  const fullState = { products: [{ id: 'P1', code: 'P1', name: 'Produkt 1', balance: 0 }], suppliers: [{ id: 'S1', code: 'S1', name: 'Furnitor', balance: 0 }], customers: [{ id: 'C1', code: 'C1', name: 'Klient', balance: 0 }], warehouses: [{ id: 'W1', code: 'W1', name: 'Magazina' }], lots: [], weighings: [], purchaseInvoices: [], salesInvoices: [], orders: [], payments: [], customerPayments: [], users: [] };
  const put0 = await call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: fullState, baseVersion: 0 }) });
  ok('admin-put-full', put0.ok && put0.data.version === 1, 'v' + put0.data.version);

  const S = await login('sal', 'salsecret1');
  ok('sal-login', S.ok && !!S.data.token);
  ok('sal-modules-scope', S.ok && S.data.modules && S.data.modules.allowedModules && JSON.stringify(S.data.modules.allowedModules) === JSON.stringify(['MOD-SAL']), JSON.stringify(S.data.modules));
  const HS = { Authorization: 'Bearer ' + S.data.token };

  // Shitësi sheh vetëm modulin e shitjeve.
  const stateSal = await call('/api/state', { headers: HS });
  const seen = stateSal.data.state;
  ok('sal-sees-customers', seen && Array.isArray(seen.customers) && seen.customers.length === 1);
  ok('sal-sees-orders', seen && Array.isArray(seen.orders));
  // Politika "të gjitha modulet për përdoruesit e serverit": shitësi sheh edhe produktet/lotet (sync i plotë),
  // por JO 'users' (vetëm-admin).
  ok('sal-sees-products-too', seen && Array.isArray(seen.products) && seen.products.length === 1, 'products=' + JSON.stringify(seen && seen.products));
  ok('sal-sees-lots-too', seen && Array.isArray(seen.lots));
  ok('sal-not-see-users', seen && seen.users === undefined, 'users=' + JSON.stringify(seen && seen.users));

  // Shitësi shkruan TË GJITHË gjendjen operacionale (si aplikacioni real) — 'users' i tij injorohet.
  const v = stateSal.data.version || 1;
  const salWrite = Object.assign({}, seen, { customers: [{ id: 'C1', code: 'C1', name: 'Klient', balance: 0 }, { id: 'C2', code: 'C2', name: 'Klient 2', balance: 0 }], orders: [{ id: 'O1' }], products: [{ id: 'P1', code: 'P1', name: 'Produkt' }, { id: 'P2', code: 'P2', name: 'Produkt 2' }], processes: [{ id: 'PR-1' }], packagings: [{ id: 'PK-1' }], users: [{ id: 'HACK-ADMIN', username: 'hack', role: 'ROLE-ADMIN' }] });
  const putSal = await call('/api/state', { method: 'PUT', headers: HS, body: JSON.stringify({ state: salWrite, baseVersion: v }) });
  ok('sal-put-ok', putSal.ok, JSON.stringify(putSal.data));

  // Admini duhet të shohë: produktet, klientët, proceset dhe paketimet e përditësuara; 'users' të paprekur.
  const stateAdmin = await call('/api/state', { headers: HA });
  const as = stateAdmin.data.state;
  ok('admin-products-updated', as.products.length === 2 && as.products.some((c) => c.id === 'P2'));
  ok('admin-customers-updated', as.customers.length === 2 && as.customers.some((c) => c.id === 'C2'));
  ok('admin-processes-packagings-synced', Array.isArray(as.processes) && as.processes.some((x) => x.id === 'PR-1') && Array.isArray(as.packagings) && as.packagings.some((x) => x.id === 'PK-1'));
  ok('admin-users-untouched', !(as.users || []).some((u) => u.id === 'HACK-ADMIN'));

  // Përdoruesi pa grup: sheh gjendjen operacionale (sync i plotë), pa 'users'; asnjë modul (të drejta) në UI.
  const N = await login('none', 'nonesecret1');
  const stateNone = await call('/api/state', { headers: { Authorization: 'Bearer ' + N.data.token } });
  ok('none-sees-operational-state', stateNone.ok && stateNone.data.state && Array.isArray(stateNone.data.state.customers) && stateNone.data.state.users === undefined, JSON.stringify(Object.keys(stateNone.data.state || {})));
  ok('none-no-modules', stateNone.data.modules && stateNone.data.modules.allowedModules.length === 0);

  // Autorizimi: shitësi s'ka qasje te administrimi.
  ok('sal-users-403', (await call('/api/admin/users', { headers: HS })).status === 403);
  ok('sal-audit-403', (await call('/api/audit', { headers: HS })).status === 403);
  ok('sal-patch-access-403', (await call('/api/access/users/' + salId + '/groups', { method: 'PATCH', headers: HS, body: JSON.stringify({ groups: ['GRP-INV-USER'] }) })).status === 403);

  // /api/auth/me i shitësit: grupet + superuser=false.
  const me = await call('/api/auth/me', { headers: HS });
  ok('sal-me-groups', me.ok && (me.data.groups || []).some((g) => g.id === 'GRP-SAL-USER') && me.data.superuser === false, JSON.stringify(me.data));

  // Admini ia ndryshon grupet shitësit → inventar (formulari Odoo i qasjes).
  const switchG = await call('/api/access/users/' + salId + '/groups', { method: 'PATCH', headers: HA, body: JSON.stringify({ groups: ['GRP-INV-USER'] }) });
  ok('admin-switch-groups', switchG.ok && switchG.data.modules && JSON.stringify(switchG.data.modules.allowedModules) === JSON.stringify(['MOD-INV']), JSON.stringify(switchG.data.modules));
  const S2 = await login('sal', 'salsecret1');
  ok('sal-now-inv', S2.ok && S2.data.modules && JSON.stringify(S2.data.modules.allowedModules) === JSON.stringify(['MOD-INV']), JSON.stringify(S2.data.modules));

  // Krijimi me role ROLE-ADMIN e fut automatikisht në GRP-SET-ADMIN.
  const admin2 = await call('/api/admin/users', { method: 'POST', headers: HA, body: JSON.stringify({ username: 'admin2', password: 'admin2pass9', name: 'Admin 2', role: 'ROLE-ADMIN', groups: [] }) });
  ok('admin2-in-grp-admin', admin2.ok && (admin2.data.user.groups || []).some((g) => g.id === 'GRP-SET-ADMIN'), JSON.stringify(admin2.data.user && admin2.data.user.groups));

  console.log('\n--- LOG SERVERI (tail) ---');
  console.log(serverLog.split('\n').slice(-15).join('\n'));
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  child.kill('SIGTERM');
  await srv.stop();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL: ' + e.stack); process.exit(1); });
