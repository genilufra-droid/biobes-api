// BioBes API — regression test për shkrime konkurruese / CAS.
// Nis server.js real mbi PGlite dhe verifikon që stale/missing baseVersion nuk mbishkruan state-in.
const { spawn } = require('child_process');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const DB_PORT = 5434;
const API_PORT = 3201;
const API = `http://127.0.0.1:${API_PORT}`;
const ADMIN = 'admin';
const PASS = 'admin12345';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
}

(async () => {
  const db = new PGlite();
  const dbServer = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1', maxConnections: 8 });
  await dbServer.start();

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

  async function call(path, opts = {}) {
    const r = await fetch(API + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    return { status: r.status, ok: r.ok, data: await r.json().catch(() => ({})) };
  }

  try {
    let health = null;
    for (let i = 0; i < 60; i++) {
      try { health = await call('/api/health'); if (health.ok && health.data.db) break; } catch (_) {}
      await sleep(250);
    }
    ok('server-booted', !!(health && health.ok && health.data.db));

    const loginA = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: ADMIN, password: PASS }) });
    const loginB = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: ADMIN, password: PASS }) });
    ok('two-sessions-login', loginA.ok && loginB.ok);
    if (!loginA.ok || !loginB.ok) throw new Error('login failed');
    const HA = { Authorization: 'Bearer ' + loginA.data.token };
    const HB = { Authorization: 'Bearer ' + loginB.data.token };

    const baseState = {
      products: [], suppliers: [], customers: [], warehouses: [], lots: [], weighings: [],
      purchaseInvoices: [], salesInvoices: [], orders: [], payments: [], customerPayments: [], users: []
    };
    const init = await call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: baseState, baseVersion: 0 }) });
    ok('initial-write-v1', init.ok && init.data.version === 1, JSON.stringify(init.data));

    const blindState = { ...baseState, customers: [{ id: 'BLIND', code: 'BLIND', name: 'Must not persist', balance: 0 }] };
    const blind = await call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: blindState }) });
    ok('missing-baseVersion-rejected', blind.status === 428 || blind.status === 400, 'HTTP ' + blind.status);
    const afterBlind = await call('/api/state', { headers: HA });
    ok('blind-write-did-not-change-state', afterBlind.ok && afterBlind.data.version === 1 && afterBlind.data.state.customers.length === 0);

    const deviceA = { ...baseState, suppliers: [{ id: 'S-A', code: 'S-A', name: 'Supplier A', balance: 0 }] };
    const deviceB = { ...baseState, customers: [{ id: 'C-B', code: 'C-B', name: 'Customer B', balance: 0 }] };

    const [writeA, writeB] = await Promise.all([
      call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: deviceA, baseVersion: 1 }) }),
      call('/api/state', { method: 'PUT', headers: HB, body: JSON.stringify({ state: deviceB, baseVersion: 1 }) }),
    ]);
    const successes = [writeA, writeB].filter((x) => x.ok);
    const conflicts = [writeA, writeB].filter((x) => x.status === 409);
    ok('exactly-one-concurrent-write-wins', successes.length === 1, JSON.stringify([writeA.status, writeB.status]));
    ok('exactly-one-stale-write-conflicts', conflicts.length === 1, JSON.stringify([writeA.status, writeB.status]));

    const finalState = await call('/api/state', { headers: HA });
    ok('version-incremented-once', finalState.ok && finalState.data.version === 2, 'v' + finalState.data.version);
    const hasA = (finalState.data.state.suppliers || []).some((x) => x.id === 'S-A');
    const hasB = (finalState.data.state.customers || []).some((x) => x.id === 'C-B');
    ok('losing-write-not-silently-overwritten', hasA !== hasB, `A=${hasA} B=${hasB}`);

    const staleRetry = await call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: baseState, baseVersion: 1 }) });
    ok('explicit-stale-retry-still-409', staleRetry.status === 409, 'HTTP ' + staleRetry.status);

    console.log(`\n${pass} PASS, ${fail} FAIL`);
    if (fail) {
      console.log('\n--- server tail ---');
      console.log(serverLog.split('\n').slice(-20).join('\n'));
      process.exitCode = 1;
    }
  } finally {
    child.kill('SIGTERM');
    await dbServer.stop();
  }
})().catch((e) => { console.error(e.stack); process.exitCode = 1; });
