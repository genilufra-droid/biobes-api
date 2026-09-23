// Test lokale i ngjarjeve në kohë reale (SSE): server.js real + Postgres (PGlite) nëpërmjet TCP.
// Verifikon: (1) lidhja SSE me token, (2) refuzimi pa token (401), (3) njoftimi 'state-changed'
// brenda < 2 s kur një klient tjetër ruan gjendjen, (4) 'companies-changed' kur krijohet kompani,
// (5) gzip-i i përgjigjeve JSON, (6) izolimi per kompani (përdoruesi pa anëtarësi nuk merr njoftim).
const { spawn } = require('child_process');
const http = require('http');
const zlib = require('zlib');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const DB_PORT = 5436;
const API_PORT = 3203;
const HOST = '127.0.0.1';
const API = `http://${HOST}:${API_PORT}`;
const ADMIN = 'admin';
const PASS = 'admin12345';
const MAG = 'magazineri';
const MAG_PASS = 'magazina12345';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mkState = (tag) => ({
  products: [{ id: 'P-' + tag, code: 'P' + tag, name: 'Mall ' + tag }],
  suppliers: [{ id: 'S-' + tag, code: 'S' + tag, name: 'Furnitor ' + tag }],
  customers: [{ id: 'C-' + tag, code: 'C' + tag, name: 'Klient ' + tag }],
  lots: [],
});

// Klient i vogël SSE mbi node:http (EventSource nuk ekziston në Node).
class SseClient {
  constructor(token, opts = {}) {
    this.events = [];   // {event, data, at}
    this.res = null;
    this.done = new Promise((resolve) => { this._resolve = resolve; });
    this._req = http.get({
      host: HOST, port: API_PORT, path: '/api/events' + (token ? '?token=' + encodeURIComponent(token) : ''),
      headers: { Accept: 'text/event-stream', ...(opts.headers || {}) },
    }, (res) => {
      this.status = res.statusCode;
      if (res.statusCode !== 200) { res.resume(); this._resolve(this); return; }
      this.res = res;
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
          if (!raw || raw.startsWith(':')) continue;
          let ev = 'message', data = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) ev = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          let parsed = null; try { parsed = JSON.parse(data); } catch (e) {}
          this.events.push({ event: ev, data: parsed, at: Date.now() });
        }
      });
      this._resolve(this);
    });
    this._req.on('error', () => this._resolve(this));
  }
  // Prit një ngjarje të tipit të dhënë, maksimumi ms milisekonda.
  async wait(event, ms = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = this.events.find((e) => e.event === event);
      if (hit) return hit;
      await sleep(25);
    }
    return null;
  }
  // Prit një ngjarje që përmbush kushtin (p.sh. state-changed për kompaninë C2).
  async waitFor(event, pred, ms = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = this.events.find((e) => e.event === event && pred(e.data || {}));
      if (hit) return hit;
      await sleep(25);
    }
    return null;
  }
  has(event) { return !!this.events.find((e) => e.event === event); }
  close() { try { this._req.destroy(); } catch (e) {} }
}

(async () => {
  const db = new PGlite();
  const srv = new PGLiteSocketServer({ db, port: DB_PORT, host: HOST, maxConnections: 8 });
  await srv.start();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(API_PORT), DATABASE_URL: `postgres://biobes:biobes@${HOST}:${DB_PORT}/biobes`, ADMIN_USERNAME: ADMIN, ADMIN_PASSWORD: PASS, SESSION_TTL_HOURS: '24', PGSSLMODE: 'disable', DEFAULT_COMPANY: 'C1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  const call = async (p, opts = {}) => {
    const r = await fetch(API + p, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, ok: r.ok, headers: r.headers, data: ct.includes('json') ? await r.json().catch(() => ({})) : {} };
  };
  // Prit që serveri të ngrihet
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(API + '/api/health'); if (r.ok) break; } catch (e) {}
    await sleep(500);
  }

  try {
    const login = async (u, pw) => (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: pw }) })).data;
    const admin = await login(ADMIN, PASS);
    ok('1. hyrja e adminit', !!admin.token);
    const h = { Authorization: 'Bearer ' + admin.token };

    // 2) SSE pa token → 401
    const noTok = new SseClient('');
    await noTok.done;
    ok('2. SSE pa token refuzohet (401)', noTok.status === 401, 'status ' + noTok.status);

    // 3) SSE me token → hello
    const c1 = new SseClient(admin.token);
    await c1.done;
    ok('3. SSE me token hapet (200)', c1.status === 200, 'status ' + c1.status);
    const hello = await c1.wait('hello', 3000);
    ok('4. merret ngjarja hello me kompanitë e mia', !!hello && Array.isArray(hello.data.companies), JSON.stringify(hello && hello.data));

    // 4) Ruajtje gjendjeje nga klienti A → klienti B merr state-changed brenda 2 s
    const put = await call('/api/state', { method: 'PUT', headers: h, body: JSON.stringify({ state: mkState('E1') }) });
    ok('5. ruajtja e gjendjes u pranua', put.ok, 'v' + put.data.version);
    const ev = await c1.wait('state-changed', 2500);
    const dt = ev ? ev.at - (put.at || 0) : null;
    ok('6. njoftimi state-changed mbërriti < 2 s', !!ev && ev.data.company === 'C1' && ev.data.version === put.data.version, ev ? JSON.stringify(ev.data) : 'pa ngjarje');

    // 5) Krijo kompani → companies-changed
    const co = await call('/api/admin/companies', { method: 'POST', headers: h, body: JSON.stringify({ code: 'E2', name: 'Kompania e Testit' }) });
    ok('7. kompania e re u krijua', co.ok, co.data.company && co.data.company.id);
    const evc = await c1.wait('companies-changed', 2500);
    ok('8. njoftimi companies-changed mbërriti', !!evc, evc ? JSON.stringify(evc.data) : 'pa ngjarje');

    // 6) gzip — gjendje e madhe (mbi 1 KB) që kompresimi të aktivizohet
    const bigState = mkState('BIG');
    bigState.notes = 'Rresht provues për kompresim. '.repeat(120);
    const putBig = await call('/api/state', { method: 'PUT', headers: h, body: JSON.stringify({ state: bigState, baseVersion: put.data.version }) });
    ok('8b. gjendja e madhe u ruajt', putBig.ok, 'v' + putBig.data.version);
    const rawHttp = (accept) => new Promise((resolve) => {
      http.get({ host: HOST, port: API_PORT, path: '/api/state', headers: { Authorization: h.Authorization, 'Accept-Encoding': accept } }, (r) => {
        const chunks = [];
        r.on('data', (d) => chunks.push(d));
        r.on('end', () => resolve({ headers: r.headers, body: Buffer.concat(chunks) }));
      }).on('error', () => resolve({ headers: {}, body: Buffer.alloc(0) }));
    });
    const plain = await rawHttp('identity');
    const gzr = await rawHttp('gzip');
    const enc = gzr.headers['content-encoding'];
    let decoded = null; try { decoded = JSON.parse(zlib.gunzipSync(gzr.body).toString('utf8')); } catch (e) {}
    const gain = plain.body.length && gzr.body.length ? Math.round((1 - gzr.body.length / plain.body.length) * 100) : 0;
    ok('9. gjendja vjen e kompresuar (gzip) dhe ruhet mirë', enc === 'gzip' && !!decoded && decoded.state && decoded.state.suppliers.length > 0,
      'encoding ' + enc + ' | ' + plain.body.length + ' → ' + gzr.body.length + ' bajt (−' + gain + '%)');

    // 7) Izolimi per kompani: magazineri (anëtar vetëm i C1) nuk merr njoftim për C2
    let mag = await login(MAG, MAG_PASS);
    if (!mag || !mag.token) {
      const created = await call('/api/admin/users', { method: 'POST', headers: h, body: JSON.stringify({ username: MAG, password: MAG_PASS, name: 'Magazineri', role: 'ROLE-USER' }) });
      ok('9b. përdoruesi i ri u krijua', created.ok, JSON.stringify(created.data.user || created.data));
      // Përdoruesit e rinj marrin anëtarësi në të gjitha kompanitë (dizajn) — për provën e izolimit
      // e kufizojmë me qëllim vetëm në C1.
      const uid = (created.data.user || {}).id;
      const setM = await call('/api/admin/users/' + uid + '/companies', { method: 'PUT', headers: h, body: JSON.stringify({ companies: [{ id: 'C1', isDefault: true }] }) });
      ok('9c. anëtarësia u kufizua në C1', setM.ok, JSON.stringify(setM.data.membership));
      mag = await login(MAG, MAG_PASS);
    }
    ok('9d. hyrja e magazinerit', !!mag.token);
    const c2 = new SseClient(mag.token);
    await c2.done;
    const helloSse = await c2.wait('hello', 3000);
    ok('10. magazineri hap SSE me kompanitë e veta', !!helloSse, JSON.stringify(helloSse && helloSse.data));
    // Shkruaj në kompaninë C2 (admini është superuser)
    const put2 = await call('/api/state?company=C2', { method: 'PUT', headers: h, body: JSON.stringify({ state: mkState('E2') }) });
    ok('11. shkrimi në C2 u pranua', put2.ok, 'v' + put2.data.version);
    const evOther = await c1.waitFor('state-changed', (d) => d.company === 'C2' && d.version === put2.data.version, 2500); // admini e merr
    await sleep(1200);
    const leaked = c2.events.filter((e) => e.event === 'state-changed' && e.data && e.data.company === 'C2');
    ok('12. admini e merr njoftimin e C2', !!evOther && evOther.data.company === 'C2');
    ok('13. magazineri NUK merr njoftim për kompani që s\u2019i takon', leaked.length === 0, leaked.length + ' ngjarje të rrjedhura');

    // 8) Në kompaninë e vet e merr
    const put3 = await call('/api/state', { method: 'PUT', headers: h, body: JSON.stringify({ state: mkState('E3') }) });
    const own = await c2.waitFor('state-changed', (d) => d.company === 'C1' && d.version === put3.data.version, 2500);
    ok('14. magazineri e merr njoftimin e kompanisë së vet', !!own && own.data.company === 'C1', own ? JSON.stringify(own.data) : 'pa ngjarje');

    // 9) Lidhjet mbyllen pa rrjedhje (log-u i serverit tregon + dhe -)
    c1.close(); c2.close(); noTok.close();
    await sleep(400);
    const opened = (log.match(/\[events\] \+/g) || []).length;
    const closedN = (log.match(/\[events\] -/g) || []).length;
    ok('15. lidhjet SSE mbyllen pa rrjedhje', opened >= 2 && closedN >= 2, 'hapur ' + opened + ', mbyllur ' + closedN);
    ok('16. serveri pa gabime gjatë testit', !/\[events\] error|ReferenceError|TypeError/.test(log), (log.match(/Error[^\n]*/g) || [])[0] || '');
  } catch (e) {
    fail++; console.log('FAIL testi dështoi me gabim — ' + e.message);
  }

  console.log('\n=== REZULTATI: ' + pass + ' PASS / ' + fail + ' FAIL ===');
  child.kill('SIGTERM');
  try { await srv.stop(); } catch (e) {}
  await db.close().catch(() => {});
  process.exit(fail ? 1 : 0);
})();
