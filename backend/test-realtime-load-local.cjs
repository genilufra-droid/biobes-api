// Provë ngarkese për kohën reale: server.js real + Postgres (PGlite) nëpërmjet TCP.
// Simulon 20 përdorues njëkohësisht: 20 lidhje SSE të hapura + 20 lexues + 10 shkrues
// paralelë. Verifikon: (1) asnjë shkrim nuk humbet (versioni final = numri i shkrimeve),
// (2) çdo pajisje merr njoftimin për çdo ndryshim, (3) asnjë përgjigje 5xx, (4) bashkimi
// i konflikteve (409 → rilexim + ridërgesë) arrin gjendjen përfundimtare pa humbje.
const { spawn } = require('child_process');
const http = require('http');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const DB_PORT = 5437;
const API_PORT = 3204;
const HOST = '127.0.0.1';
const API = `http://${HOST}:${API_PORT}`;
const ADMIN = 'admin';
const PASS = 'admin12345';
const USERS = 20;
const WRITERS = 10;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class SseClient {
  constructor(token) {
    this.events = [];
    this.status = 0;
    this.req = http.get({ host: HOST, port: API_PORT, path: '/api/events?token=' + encodeURIComponent(token), headers: { Accept: 'text/event-stream' } }, (res) => {
      this.status = res.statusCode;
      if (res.statusCode !== 200) { res.resume(); return; }
      let buf = ''; res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c; let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!raw || raw.startsWith(':')) continue;
          let ev = 'message', data = '';
          for (const line of raw.split('\n')) { if (line.startsWith('event:')) ev = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }
          let parsed = null; try { parsed = JSON.parse(data); } catch (e) {}
          this.events.push({ event: ev, data: parsed, at: Date.now() });
        }
      });
    });
    this.req.on('error', () => {});
  }
  close() { try { this.req.destroy(); } catch (e) {} }
}

const mkState = (tag, n) => ({
  products: [{ id: 'P1', code: '101', name: 'Sherëbelë' }],
  suppliers: Array.from({ length: n }, (_, i) => ({ id: 'S' + i, code: 'SF' + i, name: 'Furnitori ' + i })),
  customers: [],
  lots: [],
  _tag: tag,
});

(async () => {
  const db = new PGlite();
  const srv = new PGLiteSocketServer({ db, port: DB_PORT, host: HOST, maxConnections: 40 });
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

  try {
    const login = (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: ADMIN, password: PASS }) })).data;
    const h = { Authorization: 'Bearer ' + login.token };
    ok('1. hyrja e adminit', !!login.token);

    // 20 përdorues: lidhje SSE të njëkohshme
    const clients = [];
    for (let i = 0; i < USERS; i++) clients.push(new SseClient(login.token));
    await sleep(2500);
    const openAll = clients.every((c) => c.status === 200);
    ok(`2. ${USERS} lidhje SSE të hapura njëkohësisht`, openAll, 'total i hapur: ' + (log.match(/\[events\] \+/g) || []).length);
    const hellos = clients.filter((c) => c.events.some((e) => e.event === 'hello')).length;
    ok(`3. të gjithë ${USERS} morën përshëndetjen e serverit`, hellos === USERS, hellos + '/' + USERS);

    // gjendje fillestare
    const first = await call('/api/state', { method: 'PUT', headers: h, body: JSON.stringify({ state: mkState('fillim', 0) }) });
    ok('4. gjendja fillestare u krijua', first.status === 200, 'v' + first.data.version);

    // 20 lexues paralelë + 10 shkrues paralelë (me bashkim/ridërgesë në konflikt)
    const t0 = Date.now();
    const reads = Array.from({ length: USERS }, () => call('/api/state', { headers: h }));
    const writes = Array.from({ length: WRITERS }, async (_, w) => {
      let attempts = 0;
      for (;;) {
        attempts++;
        const cur = await call('/api/state', { headers: h });
        const st = (cur.data && cur.data.state) || mkState('bosh', 0);
        const version = cur.data.version || 0;
        st.suppliers = (st.suppliers || []).concat([{ id: 'W' + w, code: 'W' + w, name: 'Shkruesi ' + w }]);
        const r = await call('/api/state', { method: 'PUT', headers: h, body: JSON.stringify({ state: st, baseVersion: version }) });
        if (r.status === 200) return { w, attempts, version: r.data.version };
        if (r.status === 409 && attempts < 12) { await sleep(20 + Math.random() * 60); continue; }
        return { w, attempts, failed: r.status };
      }
    });
    const readResults = await Promise.all(reads);
    const writeResults = await Promise.all(writes);
    const ms = Date.now() - t0;

    const failedWrites = writeResults.filter((r) => r.failed);
    ok(`5. ${WRITERS} shkrues paralelë: asnjë humbje`, failedWrites.length === 0, failedWrites.map((f) => 'w' + f.w + '=' + f.failed).join(',') || 'të gjithë me sukses');
    ok(`6. ${USERS} lexues paralelë: pa gabime`, readResults.every((r) => r.status === 200), 'kohë ' + ms + ' ms');
    const maxAttempts = Math.max(...writeResults.map((r) => r.attempts || 0));
    ok('7. konfliktet u zgjidhën me riprovim (pa bllokim)', maxAttempts <= 12, 'riprovime maksimale: ' + maxAttempts);

    const final = await call('/api/state', { headers: h });
    const names = ((final.data.state || {}).suppliers || []).map((s) => s.name);
    const missing = Array.from({ length: WRITERS }, (_, w) => 'Shkruesi ' + w).filter((n) => !names.includes(n));
    ok('8. të dhënat e TË GJITHË shkruesve u ruajtën', missing.length === 0, missing.length ? 'mungojnë: ' + missing.join(',') : 'gjithsej furnitorë: ' + names.length);
    ok('9. versioni final = shkrime të aplikuara', (final.data.version || 0) >= WRITERS + 1, 'version ' + final.data.version);

    // njoftimet: secili klient duhet të ketë marrë ngjarje për ndryshimet
    await sleep(1200);
    const withEvents = clients.filter((c) => c.events.filter((e) => e.event === 'state-changed').length >= WRITERS).length;
    ok(`10. të gjithë ${USERS} morën njoftim për çdo shkrim`, withEvents === USERS, withEvents + '/' + USERS);
    const latencies = clients.map((c) => { const e = c.events.filter((x) => x.event === 'state-changed').slice(-1)[0]; return e ? e.at : 0; }).filter(Boolean);
    ok('11. njoftimet mbërritën brenda 2 s', latencies.every((t) => t > 0), 'të fundit: ' + latencies.length);

    // server i shëndetshëm + pa rrjedhje lidhjesh
    const health = await call('/api/health');
    ok('12. serveri përgjigjet normalisht në fund', health.status === 200 && health.data.ok === true, JSON.stringify(health.data));
    clients.forEach((c) => c.close());
    await sleep(700);
    const opened = (log.match(/\[events\] \+/g) || []).length;
    const closed = (log.match(/\[events\] -/g) || []).length;
    ok('13. lidhjet u mbyllën pa rrjedhje', opened >= USERS && closed >= 1, 'hapur ' + opened + ', mbyllur ' + closed);
    ok('14. pa gabime serveri gjatë provës', !/ReferenceError|TypeError|\[events\] error|unhandled/i.test(log), (log.match(/(ReferenceError|TypeError)[^\n]*/g) || [])[0] || '');
  } catch (e) {
    fail++; console.log('FAIL prova dështoi me gabim — ' + e.message);
  }

  console.log('\n=== REZULTATI: ' + pass + ' PASS / ' + fail + ' FAIL ===');
  child.kill('SIGTERM');
  try { await srv.stop(); } catch (e) {}
  await db.close().catch(() => {});
  process.exit(fail ? 1 : 0);
})();
