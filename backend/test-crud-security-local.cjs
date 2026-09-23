// Provat e sigurisë së CRUD-it (Faza A e auditimit).
//
// Sfondi: crud.js i merrte emrat e kolonave nga trupi i kërkesës dhe i futte
// direkt në SQL, kurse filtri i fushave të ndaluara bënte krahasim të saktë —
// kështu {"Company_ID":"C2"} zhvendoste një rresht nga C1 në C2, edhe për një
// përdorues të thjeshtë pa qasje në C2. Këto prova e mbyllin atë vrimë dhe
// verifikojnë tri gjërat që mungonin në rrugët CRUD: qasja sipas moduleve,
// gjurma e auditimit dhe izolimi sipas kompanisë.
const { spawn } = require('child_process');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const PASS = 'admin12345';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ngrin një server mbi një PGlite të vetën. Kthehet { call, stop }.
async function boot({ dbPort, apiPort, env = {} }) {
  const db = new PGlite();
  const srv = new PGLiteSocketServer({ db, port: dbPort, host: '127.0.0.1', maxConnections: 8 });
  await srv.start();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(apiPort), DATABASE_URL: `postgres://b:b@127.0.0.1:${dbPort}/b`,
           ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: PASS, SESSION_TTL_HOURS: '24', PGSSLMODE: 'disable', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (d) => (logs += d));
  child.stderr.on('data', (d) => (logs += d));
  const stop = () => { try { child.kill('SIGKILL'); } catch (_) {} try { srv.stop().catch(() => {}); } catch (_) {} };
  const API = `http://127.0.0.1:${apiPort}`;
  const call = async (p, o = {}) => {
    const r = await fetch(API + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  for (let i = 0; i < 200; i++) { try { if ((await call('/api/health')).status === 200) break; } catch (_) {} await sleep(200); }
  return { call, stop, logs: () => logs };
}

(async () => {
  // ---------- SERVERI 1: politika e parazgjedhur (SYNC_ALL_MODULES=true) ----------
  const s1 = await boot({ dbPort: 5446, apiPort: 3246 });
  process.on('exit', () => s1.stop());
  const { call } = s1;

  const admin = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: PASS }) });
  const H = { Authorization: 'Bearer ' + admin.data.token };
  const co = await call('/api/admin/companies', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Kompania B', code: 'KB' }) });
  const C2 = co.data.company && co.data.company.id;

  const p1 = await call('/api/products?company=C1', { method: 'POST', headers: H, body: JSON.stringify({ code: 'P1', name: 'Molle', price: 10 }) });
  const id = p1.data.row && p1.data.row.id;
  ok('bazë: produkti krijohet në C1', p1.status === 201 && p1.data.row.company_id === 'C1', 'status ' + p1.status);

  // 1) Sulmi që zhvendoste rreshtin midis kompanive: fusha e rezervuar injorohet.
  const atk = await call(`/api/products/${id}?company=C1`, { method: 'PATCH', headers: H, body: JSON.stringify({ Company_ID: C2, price: 99 }) });
  ok('PATCH {"Company_ID":…} nuk e zhvendos rreshtin',
     atk.status === 200 && atk.data.row && atk.data.row.company_id === 'C1', 'status ' + atk.status + ' company=' + (atk.data.row || {}).company_id);
  const inB = await call('/api/products?company=' + C2, { headers: H });
  const inA = await call('/api/products?company=C1', { headers: H });
  ok('C2 mbetet bosh', (inB.data.rows || []).length === 0, 'C2=' + JSON.stringify((inB.data.rows || []).map((r) => r.id)));
  ok('rreshti mbeti në C1', (inA.data.rows || []).length === 1 && inA.data.rows[0].company_id === 'C1');

  // 2) Variantet e tjera të së njëjtës fushë: ose injorohen, ose refuzohen — kurrë nuk zbatohen.
  // Kujdes: kodi duhet të jetë i ndryshëm për çdo variant — që nga migrimi 010
  // (company_id, code) është unik, ndaj kodi i përsëritur do të kthente 409 dhe
  // prova do të kontrollonte diçka tjetër nga ç'duhet.
  const variants = ['COMPANY_ID', 'company_Id', ' company_id', 'Company_id'];
  for (let vi = 0; vi < variants.length; vi++) {
    const variant = variants[vi];
    const r = await call('/api/products?company=C1', { method: 'POST', headers: H,
      body: JSON.stringify({ code: 'X' + (vi + 1), name: 'X', [variant]: C2 }) });
    const okVariant = (r.status === 201 && r.data.row && r.data.row.company_id === 'C1') || r.status === 400;
    ok('POST me çelësin "' + variant + '" nuk ka efekt', okVariant, 'status ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 60));
  }

  // 3) Kolona e panjohur dhe emër me SQL — 400, kurrë 500.
  const unk = await call('/api/products?company=C1', { method: 'POST', headers: H, body: JSON.stringify({ code: 'P2', name: 'Y', evil_column: 1 }) });
  ok('kolona e panjohur refuzohet me 400', unk.status === 400, 'status ' + unk.status);
  const inj = await call('/api/products?company=C1', { method: 'POST', headers: H,
    body: JSON.stringify({ code: 'P3', name: 'Z', 'price) VALUES (1); DROP TABLE company_sync; --': 1 }) });
  ok('emër kolone me SQL refuzohet me 400', inj.status === 400, 'status ' + inj.status);
  ok('serveri ende gjallë pas tentativës së injeksionit', (await call('/api/products?company=C1', { headers: H })).status === 200);

  // 4) Përditësimi i ligjshëm vazhdon të funksionojë.
  const good = await call(`/api/products/${id}?company=C1`, { method: 'PATCH', headers: H, body: JSON.stringify({ price: 25, meta: { origin: 'test' } }) });
  ok('PATCH i ligjshëm pranohet', good.status === 200 && Number(good.data.row.price) === 25, 'status ' + good.status);

  // 5) Izolimi sipas kompanisë: përdorues anëtar vetëm i C1 nuk prek dot C2.
  const u1 = await call('/api/admin/users', { method: 'POST', headers: H,
    body: JSON.stringify({ username: 'kontabilist', password: 'kontabilist1', name: 'Kont', role: 'ROLE-USER', companies: [{ id: 'C1', isDefault: true }], groups: [] }) });
  const l1 = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'kontabilist', password: 'kontabilist1' }) });
  const HU = { Authorization: 'Bearer ' + l1.data.token };
  const crossTenant = await call('/api/products?company=' + C2, { method: 'POST', headers: HU, body: JSON.stringify({ code: 'PX', name: 'Pa leje' }) });
  ok('anëtari i C1 merr 403 në C2', crossTenant.status === 403, 'status ' + crossTenant.status + ' ' + JSON.stringify(crossTenant.data).slice(0, 60));

  // 6) Gjurma e auditimit për ndryshimet e entiteteve (mungonte plotësisht).
  const del = await call(`/api/products/${id}?company=C1`, { method: 'DELETE', headers: H });
  ok('fshirja e ligjshme pranohet', del.status === 200, 'status ' + del.status);
  const aud = await call('/api/audit?limit=50', { headers: H });
  const rows = aud.data.rows || aud.data.audit || [];
  const actions = rows.map((r) => r.action);
  ok('audit ENTITY_CREATE', actions.includes('ENTITY_CREATE'), actions.slice(0, 8).join(','));
  ok('audit ENTITY_UPDATE', actions.includes('ENTITY_UPDATE'));
  ok('audit ENTITY_DELETE', actions.includes('ENTITY_DELETE'));
  ok('audit-i mban kompaninë', rows.filter((r) => String(r.action || '').startsWith('ENTITY_')).every((r) => r.company_id === 'C1'),
     JSON.stringify(rows.filter((r) => String(r.action || '').startsWith('ENTITY_')).map((r) => r.company_id)));
  s1.stop();

  // ---------- SERVERI 2: politika për grup (SYNC_ALL_MODULES=false) ----------
  const s2 = await boot({ dbPort: 5447, apiPort: 3247, env: { SYNC_ALL_MODULES: 'false' } });
  const call2 = s2.call;
  const a2 = await call2('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: PASS }) });
  const H2 = { Authorization: 'Bearer ' + a2.data.token };

  const plain = await call2('/api/admin/users', { method: 'POST', headers: H2,
    body: JSON.stringify({ username: 'paGrup', password: 'paGrup12345', name: 'Pa grup', role: 'ROLE-USER', companies: [{ id: 'C1', isDefault: true }], groups: [] }) });
  const lp = await call2('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'paGrup', password: 'paGrup12345' }) });
  const denied = await call2('/api/products?company=C1', { method: 'POST', headers: { Authorization: 'Bearer ' + lp.data.token }, body: JSON.stringify({ code: 'PN', name: 'Pa leje' }) });
  ok('politika për-grup: pa të drejtë → 403', denied.status === 403, 'status ' + denied.status + ' ' + JSON.stringify(denied.data).slice(0, 70));

  const inv = await call2('/api/admin/users', { method: 'POST', headers: H2,
    body: JSON.stringify({ username: 'magazinier', password: 'magazinier1', name: 'Mag', role: 'ROLE-USER', companies: [{ id: 'C1', isDefault: true }], groups: ['GRP-INV-USER'] }) });
  const lm = await call2('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'magazinier', password: 'magazinier1' }) });
  const allowed = await call2('/api/products?company=C1', { method: 'POST', headers: { Authorization: 'Bearer ' + lm.data.token }, body: JSON.stringify({ code: 'PO', name: 'Me leje' }) });
  ok('politika për-grup: me të drejtë → 201', allowed.status === 201, 'status ' + allowed.status + ' ' + JSON.stringify(allowed.data).slice(0, 70));
  s2.stop();

  console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
