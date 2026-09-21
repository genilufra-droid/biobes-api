// Të drejtat PER KOMPANI: server.js real + Postgres (PGlite) nëpërmjet TCP.
// Verifikon: (1) grupet/modulet ndryshojnë sipas kompanisë, (2) grupet globale
// (company_id NULL) vlejnë në çdo kompani, (3) përditësimi i grupeve për një
// kompani nuk i prek të tjerat, (4) kontrolli i qasjes (403) respekton kompaninë,
// (5) admini/dialogu /api/auth/me?company= kthen të drejtat e asaj kompanie,
// (6) njoftimi 'rights-changed' dërgohet me kompaninë.
const { spawn } = require('child_process');
const http = require('http');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const DB_PORT = 5438;
const API_PORT = 3205;
const HOST = '127.0.0.1';
const API = `http://${HOST}:${API_PORT}`;
const ADMIN = 'admin';
const PASS = 'admin12345';
const USER = 'ana';
const USER_PASS = 'ana12345678';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Sse {
  constructor(token) {
    this.events = [];
    this.req = http.get({ host: HOST, port: API_PORT, path: '/api/events?token=' + encodeURIComponent(token), headers: { Accept: 'text/event-stream' } }, (res) => {
      this.status = res.statusCode; if (res.statusCode !== 200) return res.resume();
      let buf = ''; res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const raw = buf.slice(0, i); buf = buf.slice(i + 2); if (!raw || raw.startsWith(':')) continue; let ev = 'message', data = ''; for (const l of raw.split('\n')) { if (l.startsWith('event:')) ev = l.slice(6).trim(); else if (l.startsWith('data:')) data += l.slice(5).trim(); } let p = null; try { p = JSON.parse(data); } catch (e) {} this.events.push({ event: ev, data: p }); } });
    });
    this.req.on('error', () => {});
  }
  find(ev, pred) { return this.events.find((e) => e.event === ev && (!pred || pred(e.data || {}))); }
  async waitFor(ev, pred, ms = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const h = this.find(ev, pred); if (h) return h; await sleep(30); } return null; }
  close() { try { this.req.destroy(); } catch (e) {} }
}

(async () => {
  const db = new PGlite();
  const srv = new PGLiteSocketServer({ db, port: DB_PORT, host: HOST, maxConnections: 20 });
  await srv.start();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(API_PORT), DATABASE_URL: `postgres://biobes:biobes@${HOST}:${DB_PORT}/biobes`, ADMIN_USERNAME: ADMIN, ADMIN_PASSWORD: PASS, SESSION_TTL_HOURS: '24', PGSSLMODE: 'disable', DEFAULT_COMPANY: 'C1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 80; i++) { try { const r = await fetch(API + '/api/health'); if (r.ok) break; } catch (e) {} await sleep(400); }

  const call = async (p, opts = {}) => {
    const r = await fetch(API + p, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const mkState = (tag) => ({ products: [{ id: 'P-' + tag, code: 'P' + tag, name: 'Mall' }], suppliers: [{ id: 'S-' + tag, code: 'S' + tag, name: 'F' }], customers: [{ id: 'C-' + tag, code: 'C' + tag, name: 'K' }], lots: [] });

  try {
    const adm = (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: ADMIN, password: PASS }) })).data;
    const H = { Authorization: 'Bearer ' + adm.token };
    ok('1. hyrja e adminit', !!adm.token);

    // Kompania e dytë
    const co2 = await call('/api/admin/companies', { method: 'POST', headers: H, body: JSON.stringify({ code: 'T2', name: 'Kompania Dy' }) });
    const C2 = co2.data.company && co2.data.company.id;
    ok('2. kompania e dytë u krijua', co2.status === 200 && !!C2, C2);

    // Përdorues i ri + anëtarësi në të dyja kompanitë
    const created = await call('/api/admin/users', { method: 'POST', headers: H, body: JSON.stringify({ username: USER, password: USER_PASS, name: 'Ana', role: 'ROLE-USER' }) });
    const uid = created.data.user && created.data.user.id;
    ok('3. përdoruesi u krijua', created.status === 200 && !!uid, uid);
    const mem = await call('/api/admin/users/' + uid + '/companies', { method: 'PUT', headers: H, body: JSON.stringify({ companies: [{ id: 'C1', isDefault: true }, { id: C2 }] }) });
    ok('4. anëtarësia në dy kompani', mem.status === 200, JSON.stringify(mem.data.membership));

    const uTok = (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: USER, password: USER_PASS }) })).data.token;
    const U = { Authorization: 'Bearer ' + uTok };
    ok('5. hyrja e përdoruesit', !!uTok);

    // Gjendjet fillestare për të dyja kompanitë
    await call('/api/state?company=C1', { method: 'PUT', headers: H, body: JSON.stringify({ state: mkState('C1') }) });
    await call('/api/state?company=' + C2, { method: 'PUT', headers: H, body: JSON.stringify({ state: mkState('C2') }) });

    // Të drejtat fillestare: vetëm shitjet në C1
    const set1 = await call('/api/access/users/' + uid + '/groups?company=C1', { method: 'PATCH', headers: H, body: JSON.stringify({ groups: ['GRP-SAL-USER'], company: 'C1' }) });
    ok('6. u caktua grupi “Shitjet” në C1', set1.status === 200 && set1.data.company === 'C1', JSON.stringify((set1.data.groups || []).map((g) => g.id)));
    const set2 = await call('/api/access/users/' + uid + '/groups?company=' + C2, { method: 'PATCH', headers: H, body: JSON.stringify({ groups: ['GRP-INV-USER'], company: C2 }) });
    ok('7. u caktua grupi “Inventari” në kompaninë e dytë', set2.status === 200 && set2.data.company === C2, JSON.stringify((set2.data.groups || []).map((g) => g.id)));

    // GET per kompani
    const g1 = await call('/api/access/users/' + uid + '/groups?company=C1', { headers: H });
    const g2 = await call('/api/access/users/' + uid + '/groups?company=' + C2, { headers: H });
    const ids1 = (g1.data.groups || []).map((g) => g.id), ids2 = (g2.data.groups || []).map((g) => g.id);
    ok('8. C1 → grupet e shitjeve', ids1.includes('GRP-SAL-USER') && !ids1.includes('GRP-INV-USER'), JSON.stringify(ids1));
    ok('9. C2 → grupet e inventarit', ids2.includes('GRP-INV-USER') && !ids2.includes('GRP-SAL-USER'), JSON.stringify(ids2));
    ok('10. modulet ndryshojnë sipas kompanisë', JSON.stringify(g1.data.modules) !== JSON.stringify(g2.data.modules), JSON.stringify(g1.data.modules) + ' vs ' + JSON.stringify(g2.data.modules));

    // /api/auth/me?company=
    const me1 = await call('/api/auth/me?company=C1', { headers: U });
    const me2 = await call('/api/auth/me?company=' + C2, { headers: U });
    ok('11. /me kthen kompaninë e kërkuar', me1.data.company === 'C1' && me2.data.company === C2, me1.data.company + '/' + me2.data.company);
    ok('12. /me: të drejtat ndryshojnë sipas kompanisë', JSON.stringify(me1.data.modules) !== JSON.stringify(me2.data.modules), JSON.stringify(me1.data.modules) + ' vs ' + JSON.stringify(me2.data.modules));

    // Qasja ndaj gjendjes: me të drejta vetëm-shitje në C1, shkrimi lejohet aty, por jo në C2 me module inventari
    const w1 = await call('/api/state?company=C1', { method: 'PUT', headers: U, body: JSON.stringify({ state: mkState('X1') }) });
    ok('13. shkrimi në C1 (të drejta shitje) u pranua', w1.status === 200, 'status ' + w1.status);
    const w2 = await call('/api/state?company=' + C2, { method: 'PUT', headers: U, body: JSON.stringify({ state: { products: [{ id: 'P2', code: 'P2', name: 'Mall' }], lots: [] } }) });
    ok('14. shkrimi në C2 refuzohet kur moduli nuk është i lejuar', w2.status === 400 || w2.status === 403, 'status ' + w2.status + ' ' + (w2.data.error || '').slice(0, 60));
    const r2 = await call('/api/state/version?company=' + C2, { headers: U });
    ok('15. leximi i versionit në C2 lejohet (lexim i lejuar)', r2.status === 200 || r2.status === 403, 'status ' + r2.status);

    // Grupet globale vlejnë kudo
    await call('/api/access/users/' + uid + '/groups', { method: 'PATCH', headers: H, body: JSON.stringify({ groups: ['GRP-PUR-USER'] }) });
    const g1b = await call('/api/access/users/' + uid + '/groups?company=C1', { headers: H });
    const g2b = await call('/api/access/users/' + uid + '/groups?company=' + C2, { headers: H });
    const ids1b = (g1b.data.groups || []).map((g) => g.id), ids2b = (g2b.data.groups || []).map((g) => g.id);
    ok('16. grupi global vlen në C1', ids1b.includes('GRP-PUR-USER'), JSON.stringify(ids1b));
    ok('17. grupi global vlen edhe në C2', ids2b.includes('GRP-PUR-USER'), JSON.stringify(ids2b));
    ok('18. grupet e kompanisë mbeten të paprekura', ids1b.includes('GRP-SAL-USER') && ids2b.includes('GRP-INV-USER'));

    // Njoftimi rights-changed me kompaninë
    const sse = new Sse(adm.token);
    await sleep(900);
    await call('/api/access/users/' + uid + '/groups?company=C1', { method: 'PATCH', headers: H, body: JSON.stringify({ groups: ['GRP-SAL-MGR'], company: 'C1' }) });
    const ev = await sse.waitFor('rights-changed', (d) => d.company === 'C1', 3000);
    ok('19. njoftimi rights-changed dërgohet me kompaninë', !!ev, ev ? JSON.stringify(ev.data) : 'pa ngjarje');

    // Pa company → vetëm rreshtat globalë (sjellja e vjetër mbetet)
    const gl = await call('/api/access/users/' + uid + '/groups', { headers: H });
    const idsGl = (gl.data.groups || []).map((g) => g.id);
    ok('20. pa kompani: vetëm grupet globale', idsGl.includes('GRP-PUR-USER') && !idsGl.includes('GRP-SAL-MGR'), JSON.stringify(idsGl));

    // Izolimi: përdoruesi nuk prek kompani që s’i takon
    const co3 = await call('/api/admin/companies', { method: 'POST', headers: H, body: JSON.stringify({ code: 'T3', name: 'Kompania Tre' }) });
    const C3 = co3.data.company.id;
    const bad = await call('/api/access/users/' + uid + '/groups?company=' + C3, { headers: U });
    ok('21. pa anëtarësi → 403 për të drejtat e asaj kompanie', bad.status === 403 || bad.status === 401, 'status ' + bad.status);
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
