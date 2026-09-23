// Mbrojtja e numrave të dokumenteve (F2.7): dy pajisje që krijojnë njëkohësisht
// dokument të të njëjtit lloj mund të nxjerrin të njëjtin numër (FH-/FD-/SHP-).
// Serveri e refuzon dyfishimin E RI (409 conflict:'number'); pajisja rinumeron dhe rifton.
// Nuk bllokohen KURRË: numrat e shkruar me dorë, dyfishimet e vjetra në të dhëna,
// numrat në kompani tjetër.
const { spawn } = require('child_process');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const DB_PORT = 5441;
const API_PORT = 3208;
const HOST = '127.0.0.1';
const API = `http://${HOST}:${API_PORT}`;
const ADMIN = 'admin';
const PASS = 'admin12345';

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' — ' + extra : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const db = new PGlite();
  const srv = new PGLiteSocketServer({ db, port: DB_PORT, host: HOST, maxConnections: 30 });
  await srv.start();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(API_PORT), DATABASE_URL: `postgres://biobes:biobes@${HOST}:${DB_PORT}/biobes`, ADMIN_USERNAME: ADMIN, ADMIN_PASSWORD: PASS, SESSION_TTL_HOURS: '24', PGSSLMODE: 'disable' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 80; i++) { try { const r = await fetch(API + '/api/health'); if (r.ok) break; } catch (e) {} await sleep(400); }

  const call = async (p, opts = {}) => {
    const r = await fetch(API + p, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: ADMIN, password: PASS }) });
  const H = { Authorization: 'Bearer ' + login.data.token };

  const base = {
    products: [{ id: 'P1', code: '101', name: 'Sherëbelë' }],
    suppliers: [{ id: 'S1', code: 'SF1', name: 'Furnitori 1' }],
    customers: [{ id: 'C1', code: 'K1', name: 'Klienti 1' }],
    lots: [],
    stockDocs: [{ id: 'D1', kind: 'IN', number: 'FH-2026-0001', date: '2026-09-21' }],
    expenses: [],
  };
  const put = await call('/api/state', { method: 'PUT', headers: H, body: JSON.stringify({ state: base, baseVersion: 0 }) });
  ok('1. gjendja fillestare u ruajt', put.status === 200, 'status ' + put.status);

  const patch = (ops, company) => call('/api/state/patch' + (company ? '?company=' + company : ''), { method: 'POST', headers: H, body: JSON.stringify({ ops, baseVersion: 1 }) });
  const doc = (id, number, kind) => ({ id, kind: kind || 'IN', number, date: '2026-09-21', lines: [{ product: 'P1', qty: 1 }] });
  // gjendja aktuale e serverit (për `prev` të saktë — kontrolli per dokument)
  const docsOf = async (kind, company) => {
    const r = await call('/api/state' + (company ? '?company=' + company : ''), { headers: H });
    return ((r.data && r.data.state && r.data.state[kind]) || []);
  };
  const prevOf = async (kind, id, company) => (await docsOf(kind, company)).find((d) => String(d.id) === String(id)) || null;

  // A) dy pajisje, i njëjti numër i ri → e dyta refuzohet
  const a = await patch([{ kind: 'stockDocs', op: 'upsert', id: 'D2', doc: doc('D2', 'FH-2026-0002'), prev: null }]);
  ok('2. pajisja A ruan FH-2026-0002', a.status === 200, 'status ' + a.status + ' v' + a.data.version);
  const b = await patch([{ kind: 'stockDocs', op: 'upsert', id: 'D3', doc: doc('D3', 'FH-2026-0002'), prev: null }]);
  ok('3. pajisja B me të njëjtin numër refuzohet (409)', b.status === 409 && b.data.conflict === 'number', 'status ' + b.status + ' ' + JSON.stringify(b.data.conflict || b.data.error || b.data));
  ok('4. përgjigja tregon numrin dhe dokumentin', b.data.number === 'FH-2026-0002' && b.data.id === 'D3' && b.data.kind === 'stockDocs', JSON.stringify({ n: b.data.number, id: b.data.id, k: b.data.kind }));

  // B) pajisja B rinumeron → kalon, dhe të dyja dokumentet ruhen
  const b2 = await patch([{ kind: 'stockDocs', op: 'upsert', id: 'D3', doc: doc('D3', 'FH-2026-0003'), prev: await prevOf('stockDocs', 'D3') }]);
  ok('5. pas rinumerimit ruajtja kalon', b2.status === 200, 'status ' + b2.status + ' v' + b2.data.version + ' ' + JSON.stringify(b2.data.error || ''));
  const st = await call('/api/state', { headers: H });
  const nums = (st.data.state.stockDocs || []).map((d) => d.number).sort();
  ok('6. të dyja dokumentet me numra të ndryshëm', nums.join(',') === 'FH-2026-0001,FH-2026-0002,FH-2026-0003', nums.join(','));

  // C) modifikim i një dokumenti EKZISTUES pa ndryshim numri → asnjë alarm i rremë
  const c = await patch([{ kind: 'stockDocs', op: 'upsert', id: 'D2', doc: { ...doc('D2', 'FH-2026-0002'), note: 'shtuar shënim' }, prev: await prevOf('stockDocs', 'D2') }]);
  ok('7. editim pa ndryshim numri kalon', c.status === 200, 'status ' + c.status);

  // D) numra manualë / të jashtëm → nuk bllokohen
  const m1 = await patch([{ kind: 'stockDocs', op: 'upsert', id: 'D9', doc: doc('D9', 'MAN-2026-1'), prev: null }]);
  const m2 = await patch([{ kind: 'stockDocs', op: 'upsert', id: 'D10', doc: doc('D10', 'MAN-2026-1'), prev: null }]);
  ok('8. numra manualë të njëjtë nuk bllokohen', m1.status === 200 && m2.status === 200, m1.status + '/' + m2.status);

  // E) shpenzimet kanë mbrojtjen e vet (SHP-)
  const e1 = await patch([{ kind: 'expenses', op: 'upsert', id: 'E1', doc: { id: 'E1', number: 'SHP-2026-0001', date: '2026-09-21', total: 100 }, prev: null }]);
  const e2 = await patch([{ kind: 'expenses', op: 'upsert', id: 'E2', doc: { id: 'E2', number: 'SHP-2026-0001', date: '2026-09-21', total: 50 }, prev: null }]);
  ok('9. shpenzimet: i njëjti numër refuzohet', e1.status === 200 && e2.status === 409 && e2.data.kind === 'expenses', e1.status + '/' + e2.status);

  // F) dyfishime të VJETRA në të dhëna nuk bllokojnë punën e mëtejshme
  const st2 = await call('/api/state', { headers: H });
  const put2 = await call('/api/state', { method: 'PUT', headers: H, body: JSON.stringify({ state: { ...st2.data.state, stockDocs: [...st2.data.state.stockDocs, { id: 'OLD1', kind: 'IN', number: 'FH-2019-0001', date: '2019-01-01' }, { id: 'OLD2', kind: 'IN', number: 'FH-2019-0001', date: '2019-01-02' }] }, baseVersion: st2.data.version }) });
  const old1 = await patch([{ kind: 'stockDocs', op: 'upsert', id: 'OLD2', doc: { id: 'OLD2', kind: 'IN', number: 'FH-2019-0001', date: '2019-01-02', note: 'editim i vjetër' }, prev: await prevOf('stockDocs', 'OLD2') }]);
  ok('10. dyfishim i vjetër nuk bllokon editimin', put2.status === 200 && old1.status === 200, put2.status + '/' + old1.status);

  // G) kompani tjetër → numri i njëjtë lejohet (izolim per kompani)
  const co = await call('/api/admin/companies', { method: 'POST', headers: H, body: JSON.stringify({ code: 'T2', name: 'Provë numrash 2' }) });
  const coId = co.data.company && co.data.company.id;
  const putC2 = await call('/api/state?company=' + coId, { method: 'PUT', headers: H, body: JSON.stringify({ state: base, baseVersion: 0 }) });
  const c2dup = await patch([{ kind: 'stockDocs', op: 'upsert', id: 'D2', doc: doc('D2', 'FH-2026-0002'), prev: null }], coId);
  ok('11. në kompani tjetër numri i njëjtë lejohet', putC2.status === 200 && c2dup.status === 200, putC2.status + '/' + c2dup.status);
  await call('/api/admin/companies/' + coId, { method: 'PATCH', headers: H, body: JSON.stringify({ active: false }) });

  // H) ditar auditimi + pa gabime në server
  const au = await call('/api/audit', { headers: H });
  const rows = au.data.audit || au.data.rows || [];
  ok('12. konflikti u shënua në auditim', rows.some((r) => String(r.action) === 'DOC_NUMBER_CONFLICT'), 'radhët: ' + rows.length);
  ok('13. pa gabime në logun e serverit', !/\[state:patch\]|Error:/.test(log), log.split('\n').filter((l) => /Error/.test(l)).slice(0, 2).join(' | '));

  child.kill('SIGKILL');
  await srv.stop();
  console.log('\n=== REZULTATI: ' + pass + ' PASS / ' + fail + ' FAIL ===');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.log('GABIM: ' + e.message); process.exit(1); });
