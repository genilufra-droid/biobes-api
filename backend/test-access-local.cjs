// Test lokal i skemës Odoo të qasjes (PGlite = Postgres i vërtetë në WASM).
// NUK është për produksion — vetëm verifikim i migrimeve + access.js.
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const access = require('./access');
const { validateState } = require('./validateState');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); };

(async () => {
  const db = new PGlite();

  // 1) Migrimet 001..006.
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  // 001 së pari, pastaj fusim adminin ROLE-ADMIN që seed-i i 006 ta fusë në grup.
  await db.exec(fs.readFileSync(path.join(dir, '001_initial.sql'), 'utf8'));
  await db.query(`INSERT INTO users(id,username,name,role,password_hash) VALUES('USR-ADMIN','admin','Admin','ROLE-ADMIN','x')`);
  for (const f of files) {
    if (f === '001_initial.sql') continue;
    await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  console.log('[test] migrimet u aplikuan.');

  const pool = { query: (sql, params) => db.query(sql, params) };

  // 2) Seed: modulet + grupet.
  const mods = await pool.query('SELECT COUNT(*)::int c FROM access_modules');
  ok('seed-modules=5', mods.rows[0].c === 5, 'c=' + mods.rows[0].c);
  const grps = await pool.query('SELECT COUNT(*)::int c FROM access_groups');
  ok('seed-groups=10', grps.rows[0].c === 10, 'c=' + grps.rows[0].c);
  const rights = await pool.query('SELECT COUNT(*)::int c FROM access_rights');
  ok('seed-rights>0', rights.rows[0].c > 0, 'c=' + rights.rows[0].c);

  // 3) Admini u fut në grupin Administrator nga seed-i.
  const adminGroup = await pool.query("SELECT * FROM user_groups WHERE user_id='USR-ADMIN'");
  ok('admin-in-grp-set-admin', adminGroup.rows.some((r) => r.group_id === 'GRP-SET-ADMIN'));

  // 4) Superuser → stateModules = null (gjithçka).
  const adminMods = await access.stateModules('USR-ADMIN', pool);
  ok('admin-full', adminMods === null);

  // 5) Grupet e nënkuptuara: GRP-SET-ADMIN nënkupton gjithçka.
  const adminGroups = await access.resolveGroups('USR-ADMIN', pool);
  ok('admin-implies-all', ['GRP-SET-USER', 'GRP-INV-USER', 'GRP-INV-MGR', 'GRP-SAL-USER', 'GRP-SAL-MGR', 'GRP-PUR-USER', 'GRP-PUR-MGR', 'GRP-FIN-USER', 'GRP-FIN-MGR'].every((g) => adminGroups.has(g)));

  // 6) Përdorues shitjesh: vetëm GRP-SAL-USER.
  await db.query(`INSERT INTO users(id,username,name,role,password_hash) VALUES('USR-SAL','sal','Shites','ROLE-USER','x')`);
  await db.query(`INSERT INTO user_groups(user_id,group_id) VALUES('USR-SAL','GRP-SAL-USER')`);
  const salMods = await access.stateModules('USR-SAL', pool);
  ok('sal-modules', salMods && !salMods.full && JSON.stringify(salMods.allowedModules) === JSON.stringify(['MOD-SAL']), JSON.stringify(salMods && salMods.allowedModules));
  ok('sal-fields', salMods && JSON.stringify(salMods.allowedFields) === JSON.stringify(['customers', 'orders', 'salesInvoices']), JSON.stringify(salMods && salMods.allowedFields));

  // 7) Menaxher shitjesh: GRP-SAL-MGR nënkupton GRP-SAL-USER.
  await db.query(`INSERT INTO users(id,username,name,role,password_hash) VALUES('USR-SALM','salmgr','Menaxher','ROLE-USER','x')`);
  await db.query(`INSERT INTO user_groups(user_id,group_id) VALUES('USR-SALM','GRP-SAL-MGR')`);
  const salm = await access.resolveGroups('USR-SALM', pool);
  ok('mgr-implies-user', salm.has('GRP-SAL-USER') && salm.has('GRP-SAL-MGR'));
  const salmMods = await access.stateModules('USR-SALM', pool);
  ok('mgr-modules', salmMods && JSON.stringify(salmMods.allowedModules) === JSON.stringify(['MOD-SAL']));

  // 8) modelAccess mbi app_state për shitësin: read/write, pa create/unlink.
  const acc = await access.modelAccess('USR-SAL', 'app_state', pool);
  ok('sal-appstate-read', acc && acc.read === true);
  ok('sal-appstate-write', acc && acc.write === true);
  ok('sal-appstate-no-create', acc && acc.create === false && acc.unlink === false);
  ok('checkAccess-write', access.checkAccess(acc, 'write') === true);
  ok('checkAccess-unlink-denied', access.checkAccess(acc, 'unlink') === false);

  // 9) modelAccess për modelin `users` (shitësi s'ka të drejta) → të gjitha false.
  const accUsers = await access.modelAccess('USR-SAL', 'users', pool);
  ok('sal-users-noaccess', accUsers && accUsers.read === false && accUsers.write === false);

  // 10) Filtri i gjendjes.
  const full = { products: [1], suppliers: [2], customers: [3], warehouses: [4], lots: [5], weighings: [6], purchaseInvoices: [7], salesInvoices: [8], orders: [9], payments: [10], customerPayments: [11], users: [12] };
  const filtered = access.applyStateModules(full, salMods);
  ok('filter-sales-only', JSON.stringify(Object.keys(filtered).sort()) === JSON.stringify(['customers', 'orders', 'salesInvoices']), JSON.stringify(Object.keys(filtered)));
  ok('filter-full-passthrough', access.applyStateModules(full, null) === full);

  // 11) recordMatchesDomain.
  ok('domain-eq', access.recordMatchesDomain({ warehouseId: 'WH-1' }, { warehouseId: 'WH-1' }) === true);
  ok('domain-eq-fail', access.recordMatchesDomain({ warehouseId: 'WH-2' }, { warehouseId: 'WH-1' }) === false);
  ok('domain-in', access.recordMatchesDomain({ state: 'draft' }, { state: ['in', 'draft', 'open'] }) === true);
  ok('domain-in-fail', access.recordMatchesDomain({ state: 'done' }, { state: ['in', 'draft', 'open'] }) === false);
  ok('domain-empty', access.recordMatchesDomain({ a: 1 }, {}) === true);

  // 12) validateState me onlyFields (shkrim i kufizuar në modul).
  const scoped = { customers: [{ id: 'C1' }], salesInvoices: [], orders: [] };
  ok('val-scoped-ok', validateState(scoped, { onlyFields: ['customers', 'salesInvoices', 'orders'] }).ok === true);
  const badScoped = { customers: [{ id: 'C1' }, { id: 'C1' }], salesInvoices: [], orders: [] };
  ok('val-scoped-dup-400', validateState(badScoped, { onlyFields: ['customers', 'salesInvoices', 'orders'] }).ok === false);
  // E njëjta gjendje pa onlyFields (vetëm 3 fusha të njohura të plota) kalon — por
  // një gjendje me 1 fushë duhet të refuzohet globalisht.
  ok('val-full-min3-reject', validateState({ customers: [] }).ok === false);

  // 13) Merge-i i shkrimit të kufizuar (si në PUT /api/state).
  const serverFull = { products: [{ id: 'P1' }], suppliers: [], customers: [{ id: 'C-OLD' }], warehouses: [], lots: [], weighings: [], purchaseInvoices: [], salesInvoices: [], orders: [], payments: [], customerPayments: [], users: [] };
  const incoming = { products: [{ id: 'HACK' }], customers: [{ id: 'C-NEW' }], salesInvoices: [], orders: [], extraUnknown: 1 };
  const scopedIncoming = access.applyStateModules(incoming, salMods); // hiq products + extraUnknown
  const merged = Object.assign({}, serverFull, scopedIncoming);
  ok('merge-keeps-products', JSON.stringify(merged.products) === JSON.stringify([{ id: 'P1' }]));
  ok('merge-updates-customers', JSON.stringify(merged.customers) === JSON.stringify([{ id: 'C-NEW' }]));
  ok('merge-strips-foreign', merged.extraUnknown === undefined && !('products' in scopedIncoming));

  // 14) Idempotenca e seed-it: 006 i dytë nuk duhet të dublojë.
  await db.exec(fs.readFileSync(path.join(dir, '006_odoo_access.sql'), 'utf8'));
  const grps2 = await pool.query('SELECT COUNT(*)::int c FROM access_groups');
  ok('seed-idempotent', grps2.rows[0].c === 10, 'c=' + grps2.rows[0].c);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL: ' + e.stack); process.exit(1); });
