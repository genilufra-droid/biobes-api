#!/usr/bin/env node
// BioBes API — provë ngarkese (pa varësi të reja).
//
// Mat sa kërkesa në sekondë përballon shërbimi dhe sa kohë pret përdoruesi
// (p50 / p95 / p99), duke përzier lexime dhe shkrime ashtu si bën një klient
// i vërtetë. Përdoret përpara çdo ngritjeje të çmimit/të planit në Render, që
// vendimi të mbështetet në matje dhe jo në hamendje.
//
// Përdorimi:
//   API_URL=https://... ADMIN_USER=admin ADMIN_PASS=... \
//   CONCURRENCY=20 SECONDS=30 node scripts/load-test.cjs
//
// Nëse API_URL mungon, prova ngrihet vetë mbi PGlite (vetëm në vendas).
const { spawn } = require('child_process');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const API = String(process.env.API_URL || '').replace(/\/+$/, '');
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || 'admin12345';
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 20));
const SECONDS = Math.max(1, Number(process.env.SECONDS || 20));
const PASS_MARK = Number(process.env.MAX_P95_MS || 800); // prag i pranueshëm

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

(async () => {
  let apiUrl = API;
  let serverLog = '';
  let cleanup = async () => {};
  if (!apiUrl) {
    // Mjedis i vetë-mjaftueshëm: PGlite + një instancë e serverit.
    const db = new PGlite();
    const srv = new PGLiteSocketServer({ db, port: 5599, host: '127.0.0.1', maxConnections: 40 });
    await srv.start();
    const port = 3599;
    const child = spawn(process.execPath, ['server.js'], {
      cwd: __dirname + '/..',
      env: { ...process.env, PORT: String(port), DATABASE_URL: 'postgres://b:b@127.0.0.1:5599/b',
             ADMIN_USERNAME: USER, ADMIN_PASSWORD: PASS, SESSION_TTL_HOURS: '24', PGSSLMODE: 'disable',
             POOL_MAX: process.env.POOL_MAX || '10',
             // Provës i duhet shtrati i serverit, jo kufizuesi i tij.
             RATE_LIMIT_READ_MAX: process.env.RATE_LIMIT_READ_MAX || '1000000',
             RATE_LIMIT_WRITE_MAX: process.env.RATE_LIMIT_WRITE_MAX || '1000000' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => (serverLog += d));
    child.stderr.on('data', (d) => (serverLog += d));
    apiUrl = 'http://127.0.0.1:' + port;
    cleanup = async () => { try { child.kill('SIGKILL'); } catch (e) {} try { srv.stop(); } catch (e) {} };
    for (let i = 0; i < 200; i++) {
      try { if ((await fetch(apiUrl + '/api/health')).ok) break; } catch (e) {}
      await sleep(200);
    }
  }

  // Çdo kërkesë ka afat: nëse diçka ngrin, e shohim nga prova dhe jo duke pritur.
  const call = async (p, o = {}) => {
    const r = await fetch(apiUrl + p, {
      ...o,
      headers: { 'Content-Type': 'application/json', ...(o.headers || {}) },
      signal: AbortSignal.timeout(20000),
    });
    await r.text();
    return r.status;
  };

  const login = await fetch(apiUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  }).then((r) => r.json());
  if (!login || !login.token) { console.error('DËSHTOI: hyrja (' + JSON.stringify(login).slice(0, 120) + ')'); await cleanup(); process.exit(1); }
  const H = { Authorization: 'Bearer ' + login.token };

  // Pak të dhëna, që leximet të mos kthejnë lista bosh.
  for (let i = 0; i < 25; i++) {
    await call('/api/products?company=C1', { method: 'POST', headers: H, body: JSON.stringify({ code: 'LP' + i, name: 'Produkt ' + i, price: 10 + i }) });
  }

  const latencies = [];
  const codes = {};
  let ops = 0, errs = 0;
  const stopAt = Date.now() + SECONDS * 1000;

  async function worker(n) {
    while (Date.now() < stopAt) {
      const r = Math.random();
      const t0 = process.hrtime.bigint();
      let status;
      try {
        if (r < 0.60) status = await call('/api/products?company=C1&limit=50', { headers: H });
        else if (r < 0.80) status = await call('/api/products?company=C1', { method: 'POST', headers: H, body: JSON.stringify({ code: 'LN' + n + '-' + ops, name: 'N' + ops, price: 5 }) });
        else if (r < 0.90) status = await call('/api/state', { headers: H });
        else status = await call('/api/health', {});
      } catch (e) { status = 'ERR'; if (++errs <= 3) console.log('  [kërkesa dështoi] ' + e.name + ' ' + e.message); }
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      latencies.push(ms);
      codes[status] = (codes[status] || 0) + 1;
      ops++;
    }
  }

  console.log('[ngarkesë] ' + CONCURRENCY + ' klientë paralelë për ' + SECONDS + ' s kundër ' + apiUrl);
  if (!API) {
    console.log('Kujdes: pa API_URL prova ngrihet mbi PGlite, i cili i shërben të gjitha ' +
                'lidhjet nga një seancë e vetme — matjet janë vetëm orientuese dhe disa ' +
                'kërkesa dështojnë nga vetë motori. Për shifra të vërteta: API_URL=https://…');
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  const secs = (Date.now() - t0) / 1000;

  const rps = ops / secs;
  const p50 = pct(latencies, 50), p95 = pct(latencies, 95), p99 = pct(latencies, 99);
  const errors = Object.entries(codes).filter(([k]) => String(k) === 'ERR' || Number(k) >= 500).reduce((a, [, v]) => a + v, 0);
  console.log('\n=== REZULTATI ===');
  console.log('kërkesa: ' + ops + '  shpejtësia: ' + rps.toFixed(1) + ' kërk/s');
  console.log('vonesa: p50 ' + p50.toFixed(0) + ' ms | p95 ' + p95.toFixed(0) + ' ms | p99 ' + p99.toFixed(0) + ' ms | max ' + Math.max(...latencies).toFixed(0) + ' ms');
  console.log('kodet: ' + JSON.stringify(codes));
  console.log('gabime serveri: ' + errors + ' (' + ((errors / ops) * 100).toFixed(2) + ' %)');
  if (process.env.LOADTEST_LOG) { try { require('fs').writeFileSync(process.env.LOADTEST_LOG, serverLog); console.log('\nlogu i plotë: ' + process.env.LOADTEST_LOG); } catch (e) {} }
  if (serverLog) {
    const errLines = serverLog.split('\n').filter((l) => /"level":"error"|\[.*\] /i.test(l) && /error|Error|GABIM/.test(l)).slice(0, 8);
    if (errLines.length) { console.log('\nGabimet e para të serverit:'); errLines.forEach((l) => console.log('  ' + l.slice(0, 220))); }
  }
  const okRun = errors === 0 && p95 <= PASS_MARK;
  console.log(okRun ? '\nKALOI: p95 brenda ' + PASS_MARK + ' ms dhe pa gabime serveri.'
                    : '\nDËSHTOI: p95 mbi ' + PASS_MARK + ' ms ose ka gabime — rishiko indeksët/kapacitetin.');
  await cleanup();
  process.exit(okRun ? 0 : 1);
})().catch(async (e) => { console.error('DËSHTOI: ' + e.message); process.exit(1); });
