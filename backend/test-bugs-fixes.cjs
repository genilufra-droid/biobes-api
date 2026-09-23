// Test: Bug-et reale — kompanitë nuk fshihen nga një shkrim i cunguar,
// SSE njofton pajisjet e tjera, wipe detyron pastrim.
const { spawn } = require('child_process');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const DB_PORT = 5434;
const API_PORT = 3202;
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

  // Pastrim i garantuar: nëse testi dështon në mes, procesi i serverit dhe
  // PGlite-i mbeteshin gjallë dhe zinin portat (3202/3203, 5434/5435).
  const cleanup = () => { try { child.kill('SIGKILL'); } catch (_) {} try { srv.stop().catch(() => {}); } catch (_) {} };
  process.on('exit', cleanup);
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d; });
  child.stderr.on('data', (d) => { serverLog += d; });

  const call = async (p, opts = {}) => {
    const r = await fetch(API + p, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    return { status: r.status, ok: r.ok, data: await r.json().catch(() => ({})) };
  };
  const login = async (u, pw) => call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: pw }) });

  for (let i = 0; i < 200; i++) { try { if ((await call('/api/health')).ok) break; } catch (_) {} await sleep(200); }

  const A = await login(ADMIN, PASS);
  if (!A.ok) { console.log(serverLog); process.exit(1); }
  const HA = { Authorization: 'Bearer ' + A.data.token };

  // 1) Shkruajmë një state ME DY KOMPANI (si një admin normal).
  const stateWithCompanies = {
    companies: [{ id: 'CO-1', name: 'Kompania 1', taxId: 'K1' }, { id: 'CO-2', name: 'Kompania 2', taxId: 'K2' }],
    products: [{ id: 'P1', code: 'P1', name: 'Molle', balance: 0 }],
    customers: [{ id: 'C1', code: 'C1', name: 'Klienti', balance: 0 }],
    suppliers: [{ id: 'S1', code: 'S1', name: 'Furnitori', balance: 0 }],
    warehouses: [{ id: 'W1', code: 'W1', name: 'Magazina' }],
    lots: [], weighings: [], payments: [], customerPayments: [],
    purchaseInvoices: [], salesInvoices: [], orders: [], users: [],
    settings: {}, sequences: {},
  };
  const put1 = await call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: stateWithCompanies, baseVersion: 0 }) });
  ok('put-with-2-companies', put1.ok, 'v' + put1.data.version);

  // 2) Simulojmë një pajisje tjetër me cache të vjetër që s'i ka kompanitë
  // (p.sh. app s'u përditësua, localStorage i vjetër) dhe që dërgon state PA fushën 'companies'.
  const staleState = {
    products: [{ id: 'P1', code: 'P1', name: 'Molle', balance: 5 }], // ndryshoi bilancin
    customers: [{ id: 'C1', code: 'C1', name: 'Klienti', balance: 0 }],
    suppliers: [{ id: 'S1', code: 'S1', name: 'Furnitori', balance: 0 }],
    warehouses: [{ id: 'W1', code: 'W1', name: 'Magazina' }],
    lots: [], weighings: [], payments: [], customerPayments: [],
    purchaseInvoices: [], salesInvoices: [], orders: [], users: [],
    settings: {}, sequences: {},
  };
  const put2 = await call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: staleState, baseVersion: put1.data.version }) });
  ok('stale-put-returns-merged', put2.ok && put2.data.mergedFromServer === true, JSON.stringify(put2.data));

  // 3) Verifikojmë që KOMPANITË nuk u fshinë.
  const s = await call('/api/state', { headers: HA });
  const companies = s.data.state && s.data.state.companies ? s.data.state.companies : [];
  ok('companies-not-deleted', companies.length === 2, 'companies=' + JSON.stringify(companies.map(c => c.id)));
  const prod = (s.data.state.products || []).find(p => p.id === 'P1');
  ok('products-merged-balance', prod && prod.balance === 5, 'balance=' + (prod && prod.balance));

  // 4) SSE: pajisja B lidhet dhe duhet ta marrë eventin 'state-changed' kur A bën ndryshim.
  const eventsReceived = [];
  let sseOpened = false;
  const B = await login(ADMIN, PASS);
  await new Promise((resolve, reject) => {
    const u = new URL(API + '/api/events');
    u.searchParams.set('token', B.data.token);
    // Node 22 fetch i mbështet HTTP streaming por leximi është async; lexojmë manualisht.
    fetch(u.toString()).then((resp) => {
      ok('sse-connected', resp.status === 200 && String(resp.headers.get('content-type') || '').startsWith('text/event-stream'), 'status=' + resp.status + ' ct=' + resp.headers.get('content-type'));
      sseOpened = true;
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop();
          for (const p of parts) {
            const m = p.match(/^event:\s*(\S+).*?^data:\s*(\{.*\})/ms);
            if (m) { eventsReceived.push({ event: m[1], data: JSON.parse(m[2]) }); }
            if (eventsReceived.some(e => e.event === 'state-changed')) { try { reader.cancel(); } catch(_){} resolve(); return; }
          }
        }
      };
      pump();
      // Bëj një ndryshim nga A për të shkaktuar event.
      setTimeout(async () => {
        const cur = await call('/api/state', { headers: HA });
        const st = cur.data.state;
        st.products = st.products || [];
        st.products.push({ id: 'P-SSE', code: 'P-SSE', name: 'SSE product', balance: 0 });
        await call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: st, baseVersion: cur.data.version }) });
      }, 500);
      // Timeout 5s.
      setTimeout(() => resolve(), 5000);
    }).catch(reject);
  });
  const gotChange = eventsReceived.some(e => e.event === 'state-changed');
  ok('sse-state-changed-received', gotChange, 'events=' + eventsReceived.map(e=>e.event).join(','));

  // 5) /api/state kthen fetchPolicy='server-authoritative' → frontend e di
  // që duhet të mbishkruajë cache lokale.
  ok('server-authoritative-flag', s.data.fetchPolicy === 'server-authoritative', 'policy=' + s.data.fetchPolicy);

  // 6) SSE për wipe: bëjmë wipe dhe kontrollojmë që pajisja merr eventin 'wipe'.
  const wipeEvents = [];
  await new Promise((resolve) => {
    const u = new URL(API + '/api/events');
    u.searchParams.set('token', B.data.token);
    fetch(u.toString()).then((resp) => {
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop();
          for (const part of parts) {
            const m = part.match(/^event:\s*(\S+).*?^data:\s*(\{.*\})/ms);
            if (m) wipeEvents.push({ event: m[1], data: JSON.parse(m[2]) });
          }
          if (wipeEvents.some(e => e.event === 'wipe')) { try { reader.cancel(); } catch(_){} resolve(); return; }
        }
      };
      pump();
      setTimeout(async () => {
        await call('/api/admin/wipe', { method: 'POST', body: JSON.stringify({ password: PASS }) });
      }, 500);
      setTimeout(() => resolve(), 5000);
    }).catch(() => resolve());
  });
  // main e dërgon pastrimin si event 'state-changed' me fushën wiped:true.
  ok('sse-wipe-received', wipeEvents.some(e => e.event === 'wipe' || (e.event === 'state-changed' && e.data && e.data.wiped === true)), 'wipeEvents=' + wipeEvents.map(e=>e.event).join(','));

  console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
  child.kill('SIGTERM');
  srv.stop().catch(() => {});
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });
