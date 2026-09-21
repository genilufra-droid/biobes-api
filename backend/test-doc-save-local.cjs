// Ruajtja PËR DOKUMENT (F2.3): server.js real + Postgres (PGlite) nëpërmjet TCP.
// Verifikon: (1) ruajtja e vetëm një dokumenti nuk prek të tjerët, (2) dy pajisje
// që shkruajnë dokumente të ndryshme njëkohësisht NUK humbin asnjë ndryshim,
// (3) dy pajisje që shkruajnë TË NJËJTIN dokument: e dyta merr 409 dhe versioni
// mbetet konsistent, (4) fshirja e një dokumenti, (5) kontroll versioni (baseVersion),
// (6) të drejtat per modul respektohen, (7) njoftimi SSE dërgohet me versionin e ri,
// (8) gjendja pa gjendje në server → 409 me `empty` (fronti dërgon të plotën).
const { spawn } = require('child_process');
const http = require('http');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const DB_PORT = 5439;
const API_PORT = 3206;
const HOST = '127.0.0.1';
const API = `http://${HOST}:${API_PORT}`;
const ADMIN = 'admin';
const PASS = 'admin12345';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Sse {
  constructor(token) {
    this.events = [];
    this.req = http.get({ host: HOST, port: API_PORT, path: '/api/events?token=' + encodeURIComponent(token), headers: { Accept: 'text/event-stream' } }, (res) => {
      this.status = res.statusCode; if (res.statusCode !== 200) return res.resume();
      let buf = ''; res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const raw = buf.slice(0, i); buf = buf.slice(i + 2); if (!raw || raw.startsWith(':')) continue; let ev = 'message', data = ''; for (const l of raw.split('\n')) { if (l.startsWith('event:')) ev = l.slice(6).trim(); else if (l.startsWith('data:')) data += l.slice(5).trim(); } let p = null; try { p = JSON.parse(data); } catch (e) {} this.events.push({ event: ev, data: p, at: Date.now() }); } });
    });
    this.req.on('error', () => {});
  }
  async waitFor(ev, pred, ms = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const h = this.events.find((e) => e.event === ev && (!pred || pred(e.data || {}))); if (h) return h; await sleep(25); } return null; }
  close() { try { this.req.destroy(); } catch (e) {} }
}

const mkState = (n) => ({
  products: [{ id: 'P1', code: '101', name: 'Sherëbelë' }],
  suppliers: Array.from({ length: n }, (_, i) => ({ id: 'S' + i, code: 'SF' + i, name: 'Furnitori ' + i })),
  customers: [{ id: 'C1', code: 'K1', name: 'Klienti 1' }],
  lots: [],
  notes: ['shënim fillestar'],
});

(async () => {
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

  try {
    const adm = (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: ADMIN, password: PASS }) })).data;
    const H = { Authorization: 'Bearer ' + adm.token };
    ok('1. hyrja e adminit', !!adm.token);

    const put = await call('/api/state', { method: 'PUT', headers: H, body: JSON.stringify({ state: mkState(3) }) });
    ok('2. gjendja fillestare (3 furnitorë)', put.status === 200, 'v' + put.data.version);

    // (1) një dokument i vetëm
    const one = await call('/api/state/patch', { method: 'POST', headers: H, body: JSON.stringify({ ops: [{ kind: 'suppliers', op: 'upsert', id: 'S9', doc: { id: 'S9', code: 'SF9', name: 'Furnitori i ri' } }] }) });
    ok('3. ruajtja e një dokumenti u pranua', one.status === 200 && one.data.applied === 1, 'v' + one.data.version + ' / ' + one.data.kinds);
    const g1 = await call('/api/state', { headers: H });
    ok('4. dokumenti i ri është në gjendje', (g1.data.state.suppliers || []).some((x) => x.id === 'S9'));
    ok('5. të tjerët nuk u prekën', (g1.data.state.suppliers || []).length === 4 && (g1.data.state.customers || []).length === 1 && (g1.data.state.notes || []).length === 1, 'furnitorë=' + g1.data.state.suppliers.length);

    // (2) dy pajisje, dokumente të ndryshme, njëkohësisht
    const base = g1.data.version;
    const [r1, r2] = await Promise.all([
      call('/api/state/patch', { method: 'POST', headers: H, body: JSON.stringify({ ops: [{ kind: 'suppliers', op: 'upsert', id: 'SA', doc: { id: 'SA', code: 'SFA', name: 'Nga A' }, prev: null }], baseVersion: base }) }),
      call('/api/state/patch', { method: 'POST', headers: H, body: JSON.stringify({ ops: [{ kind: 'suppliers', op: 'upsert', id: 'SB', doc: { id: 'SB', code: 'SFB', name: 'Nga B' }, prev: null }], baseVersion: base }) }),
    ]);
    const bothOk = r1.status === 200 && r2.status === 200;
    ok('6. dy shkrime njëkohësisht (dokumente të ndryshme): asnjë humbje', bothOk, 'statuset: ' + r1.status + '/' + r2.status);
    const g2 = await call('/api/state', { headers: H });
    const hasA = (g2.data.state.suppliers || []).some((x) => x.id === 'SA');
    const hasB = (g2.data.state.suppliers || []).some((x) => x.id === 'SB');
    ok('7. TË DYJA dokumentet u ruajtën', hasA && hasB, 'SA=' + hasA + ', SB=' + hasB + ', gjithsej=' + g2.data.state.suppliers.length);
    ok('8. versioni u rrit për të dyja', (g2.data.version || 0) >= base + 2, 'v' + g2.data.version);

    // (3) i njëjti dokument nga dy pajisje → e dyta 409
    const v = g2.data.version;
    const prevC1 = (g2.data.state.customers || [])[0] || null;
    const [d1, d2] = await Promise.all([
      call('/api/state/patch', { method: 'POST', headers: H, body: JSON.stringify({ ops: [{ kind: 'customers', op: 'upsert', id: 'C1', doc: { id: 'C1', code: 'K1', name: 'Emri A' }, prev: prevC1 }], baseVersion: v }) }),
      call('/api/state/patch', { method: 'POST', headers: H, body: JSON.stringify({ ops: [{ kind: 'customers', op: 'upsert', id: 'C1', doc: { id: 'C1', code: 'K1', name: 'Emri B' }, prev: prevC1 }], baseVersion: v }) }),
    ]);
    const statuses = [d1.status, d2.status].sort((a, b) => a - b);
    ok('9. i njëjti dokument me të njëjtën `prev`: një pranohet, tjetri konflikt', statuses[0] === 200 && statuses[1] === 409, 'statuset: ' + statuses.join('/'));
    const conflictBody = (d1.status === 409 ? d1 : d2).data;
    ok('9b. konflikti tregon dokumentin dhe vlerën aktuale', conflictBody.kind === 'customers' && conflictBody.id === 'C1' && !!(conflictBody.current && conflictBody.current.name), JSON.stringify({ kind: conflictBody.kind, id: conflictBody.id, now: conflictBody.current && conflictBody.current.name }));
    const g3 = await call('/api/state', { headers: H });
    ok('10. gjendja mbetet konsistente (një emër)', ['Emri A', 'Emri B'].includes((g3.data.state.customers || [])[0].name), JSON.stringify((g3.data.state.customers || [])[0]));

    // (4) fshirja
    const del = await call('/api/state/patch', { method: 'POST', headers: H, body: JSON.stringify({ ops: [{ kind: 'suppliers', op: 'delete', id: 'SA' }], baseVersion: g3.data.version }) });
    ok('11. fshirja e dokumentit u pranua', del.status === 200, 'v' + del.data.version);
    const g4 = await call('/api/state', { headers: H });
    ok('12. dokumenti u fshi vetëm ai', !(g4.data.state.suppliers || []).some((x) => x.id === 'SA') && (g4.data.state.suppliers || []).some((x) => x.id === 'SB'));

    // (5) fusha e vetme (set) — settings/meta
    const setRes = await call('/api/state/patch', { method: 'POST', headers: H, body: JSON.stringify({ ops: [{ kind: 'settings', op: 'set', doc: { theme: 'e gjelbër' } }], baseVersion: g4.data.version }) });
    ok('13. ruajtja e një fushe të vetme (set)', setRes.status === 200, 'v' + setRes.data.version);
    const g5 = await call('/api/state', { headers: H });
    ok('14. vlera u ruajt', (g5.data.state.settings || {}).theme === 'e gjelbër');

    // (6) version i gabuar → 409 me versionin e saktë
    const stale = await call('/api/state/patch', { method: 'POST', headers: H, body: JSON.stringify({ ops: [{ kind: 'suppliers', op: 'upsert', id: 'SX', doc: { id: 'SX', code: 'SFX', name: 'X' }, prev: null }], baseVersion: 1 }) });
    ok('15. versioni global i vjetër nuk bllokon (ndryshimi është per dokument)', stale.status === 200 && stale.data.version > g5.data.version, 'status ' + stale.status + ' / v' + stale.data.version);
    const g5b = await call('/api/state', { headers: H });
    ok('15b. dokumenti i ri u shtua pa humbur të tjerët', (g5b.data.state.suppliers || []).some((x) => x.id === 'SX') && (g5b.data.state.suppliers || []).some((x) => x.id === 'SB'), 'furnitorë=' + (g5b.data.state.suppliers || []).length);

    // (7) SSE me versionin e ri + fushën
    const sse = new Sse(adm.token);
    await sleep(800);
    const pr = await call('/api/state/patch', { method: 'POST', headers: H, body: JSON.stringify({ ops: [{ kind: 'suppliers', op: 'upsert', id: 'SZ', doc: { id: 'SZ', code: 'SFZ', name: 'Z' }, prev: null }], baseVersion: g5b.data.version }) });
    const ev = await sse.waitFor('state-changed', (d) => d.version === pr.data.version, 3000);
    ok('16. njoftimi SSE dërgohet me versionin e ri dhe fushën', !!ev && ev.data.patch === true && /suppliers/.test(ev.data.kinds || ''), ev ? JSON.stringify(ev.data) : 'pa ngjarje');

    // (8) pa gjendje në server → 409 me `empty`
    const co2 = await call('/api/admin/companies', { method: 'POST', headers: H, body: JSON.stringify({ code: 'P2', name: 'Kompania Pa Gjendje' }) });
    const C2 = co2.data.company.id;
    const empty = await call('/api/state/patch?company=' + C2, { method: 'POST', headers: H, body: JSON.stringify({ ops: [{ kind: 'suppliers', op: 'upsert', id: 'S1', doc: { id: 'S1', code: 'SF1', name: 'X' } }] }) });
    ok('17. kompani pa gjendje → 409 me `empty` (dërgohet e plota)', empty.status === 409 && empty.data.empty === true, JSON.stringify(empty.data));

    // (9) të drejtat per modul: përdorues me vetëm shitje nuk shkruan inventar
    const u = await call('/api/admin/users', { method: 'POST', headers: H, body: JSON.stringify({ username: 'shitesi', password: 'shitesi1234', name: 'Shitësi', role: 'ROLE-USER' }) });
    const uid = u.data.user.id;
    await call('/api/access/users/' + uid + '/groups', { method: 'PATCH', headers: H, body: JSON.stringify({ groups: ['GRP-SAL-USER'] }) });
    const ut = (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'shitesi', password: 'shitesi1234' }) })).data.token;
    const U = { Authorization: 'Bearer ' + ut };
    const cur = await call('/api/state', { headers: H });
    const badUsers = await call('/api/state/patch', { method: 'POST', headers: U, body: JSON.stringify({ ops: [{ kind: 'users', op: 'set', doc: [{ id: 'X', username: 'haker' }] }], baseVersion: cur.data.version }) });
    ok('18. fusha vetëm-admin (users) refuzohet për përdoruesin', badUsers.status === 400 || badUsers.status === 403, 'status ' + badUsers.status + ' ' + (badUsers.data.error || '').slice(0, 50));
    const good = await call('/api/state/patch', { method: 'POST', headers: U, body: JSON.stringify({ ops: [{ kind: 'customers', op: 'upsert', id: 'CX', doc: { id: 'CX', code: 'KX', name: 'Klienti i shitësit' }, prev: null }], baseVersion: cur.data.version }) });
    ok('19. fushat operacionale pranohen (politika syncPolicy=all-modules)', good.status === 200, 'status ' + good.status + ' ' + (good.data.error || ''));

    // (10) pa gabime serveri
    ok('20. serveri pa gabime gjatë provës', !/\[state:patch\].*Error|ReferenceError|TypeError/.test(log), (log.match(/\[state:patch\][^\n]*/g) || [])[0] || '');
    sse.close();
  } catch (e) {
    fail++; console.log('FAIL testi dështoi — ' + e.message);
  }

  console.log('\n=== REZULTATI: ' + pass + ' PASS / ' + fail + ' FAIL ===');
  child.kill('SIGTERM');
  try { await srv.stop(); } catch (e) {}
  await db.close().catch(() => {});
  process.exit(fail ? 1 : 0);
})();
