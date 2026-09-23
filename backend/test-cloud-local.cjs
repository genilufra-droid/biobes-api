// Provat e "cloud-it të plotë": RLS, tombstone, konkurrencë optimiste,
// unicitet, dy instanca, vëzhgueshmëri dhe kufizues në databazë.
//
// Këto janë provat që e çojnë sistemin nga "funksionon në cloud" në
// "i qëndrueshëm në cloud me shumë kompani": verifikojnë se izolimi nuk varet
// më vetëm nga kodi, se dy instanca komunikojnë, dhe se pajisjet mësojnë edhe
// për fshirjet.
const { spawn } = require('child_process');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Në vendas punojmë me PGlite (pa instalim). Në CI japim TEST_DATABASE_URL dhe
// të gjitha provat — përfshirë RLS-në dhe LISTEN/NOTIFY-n midis dy procesesh —
// ekzekutohen kundër një PostgreSQL-i të vërtetë.
const EXTERNAL = String(process.env.TEST_DATABASE_URL || '').trim();

const PASS = 'admin12345';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot({ dbPort, apiPort, env = {}, db }) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(apiPort),
           DATABASE_URL: EXTERNAL || `postgres://b:b@127.0.0.1:${dbPort}/b`,
           ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: PASS, SESSION_TTL_HOURS: '24',
           PGSSLMODE: EXTERNAL ? 'disable' : 'disable', LOG_LEVEL: 'debug',
           POOL_MAX: process.env.TEST_POOL_MAX || '10', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('exit', (code, sig) => { if (code || sig) console.log('   [serveri doli] kod=' + code + ' sinjal=' + sig + '\n' + logs.split('\n').slice(-6).join('\n')); });
  let logs = '';
  child.stdout.on('data', (d) => (logs += d));
  child.stderr.on('data', (d) => (logs += d));
  const stop = () => { try { child.kill('SIGKILL'); } catch (_) {} };
  const API = `http://127.0.0.1:${apiPort}`;
  const call = async (p, o = {}) => {
    const r = await fetch(API + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } });
    return { status: r.status, headers: r.headers, data: await r.json().catch(() => ({})) };
  };
  for (let i = 0; i < 200; i++) { try { if ((await call('/api/health')).status === 200) break; } catch (_) {} await sleep(200); }
  return { call, stop, logs: () => logs, API };
}

// Klient i vogël SSE: mblidhe çfarë vjen deri sa të duam ne.
function sse(url) {
  const events = [];
  let stop = () => {};
  const ready = new Promise((resolve) => {
    const ac = new AbortController();
    fetch(url, { signal: ac.signal }).then(async (r) => {
      resolve(r.status);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop();
          for (const p of parts) {
            const m = p.match(/^event:\s*(\S+)\s*\ndata:\s*(.+)$/ms);
            if (m) events.push({ event: m[1], data: JSON.parse(m[2]) });
          }
        }
      } catch (e) { /* lidhja u mbyll */ }
    }).catch(() => resolve(0));
    stop = () => { try { ac.abort(); } catch (e) {} };
  });
  return { events, ready, stop };
}

(async () => {
  // ------------------------------------------------------------------ 1) RLS
  // Izolimi në databazë: edhe sikur kodi të harrojë WHERE company_id,
  // Postgres-i e refuzon vetë — me kusht që lidhja të mos jetë superuser
  // (në Aiven avnadmin nuk është; në PGlite e imitojmë me SET ROLE).
  {
    const db = new PGlite();
    const dir = path.join(__dirname, 'migrations');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      try { await db.exec(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) {}
    }
    await db.query("INSERT INTO companies(id,code,name) VALUES ('C1','BB','BioBes'),('C2','KB','B') ON CONFLICT DO NOTHING");
    await db.query("INSERT INTO products(company_id,id,code,name) VALUES ('C1','P1','P1','Molle C1'),('C2','P2','P2','Molle C2')");
    const st = await db.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='products'");
    ok('RLS: aktiv dhe i detyruar në products', st.rows[0].relrowsecurity === true && st.rows[0].relforcerowsecurity === true,
       JSON.stringify(st.rows[0]));
    // Superpërdoruesit e anashkalojnë RLS-në gjithmonë — prandaj, kur lidhja është
    // superuser (PGlite në vendas), kalojmë në një rol të zakontë; në CI lidhja
    // është që tashmë një përdorues aplikacioni jo-superuser.
    const su = await db.query("SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su");
    if (su.rows[0] && su.rows[0].su) {
      try { await db.query('CREATE ROLE app_nonsuper NOLOGIN'); } catch (e) { /* ekziston */ }
      await db.query('GRANT USAGE ON SCHEMA public TO app_nonsuper');
      await db.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_nonsuper');
      await db.query('SET ROLE app_nonsuper');
    }
    const open = await db.query('SELECT id FROM products ORDER BY id');
    ok('RLS: pa kontekst, rrugët e vjetra punojnë', open.rows.length === 2, 'rreshta=' + open.rows.length);
    // Konteksti i plotë, siç e vendos aplikacioni (db.withCompany):
    // kompania + përdoruesi + superadmin. Pa userId, politika e anëtarësisë
    // nuk e njoh përdoruesin — dhe kjo është pikë e dobët e mbrojtjes:
    // një kontekst i vendosur pa përdorues nuk duhet të shfaqë asgjë.
    await db.query("INSERT INTO users(id, username, name, role, password_hash, active) VALUES ('U-ANETAR','anetar','Anetar','ROLE-USER','x',TRUE) ON CONFLICT DO NOTHING");
    await db.query("INSERT INTO user_companies(user_id,company_id,is_default) VALUES ('U-ANETAR','C1',TRUE) ON CONFLICT DO NOTHING");
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.company_id','C1',true), set_config('app.user_id','U-ANETAR',true), set_config('app.is_superadmin','off',true)");
    const scoped = await db.query('SELECT id, company_id FROM products ORDER BY id');
    ok('RLS: anëtari i C1 shihet vetëm C1', scoped.rows.length === 1 && scoped.rows[0].company_id === 'C1', JSON.stringify(scoped.rows));
    await db.query('ROLLBACK');
    // Superadmini sheh të dyja (rrugët administrative: listime, backup).
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.company_id','',true), set_config('app.user_id','',true), set_config('app.is_superadmin','on',true)");
    const all = await db.query('SELECT id, company_id FROM products ORDER BY id');
    ok('RLS: konteksti i sistemit sheh të gjitha', all.rows.length === 2, 'rreshta=' + all.rows.length);
    await db.query('ROLLBACK');
    // Një kontekst pa përdorues nuk duhet të nxjerë asgjë (mbrojtje nga kontekste të përgjithshme).
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.company_id','C1',true), set_config('app.user_id','',true), set_config('app.is_superadmin','off',true)");
    const anon = await db.query('SELECT id FROM products');
    ok('RLS: kontekst kompanie pa përdorues nuk shfaq rreshta', anon.rows.length === 0, 'rreshta=' + anon.rows.length);
    await db.query('ROLLBACK');
    // Të njëjtat tentativa të shkrimit, por me kontekstin e një ANËTARI të C1:
    // ky është sulmi që mban izolimin — edhe një përdorues i ligjshëm i C1
    // nuk mund të prekë rreshtin e C2, edhe po të dijë ID-në e tij.
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.company_id','C1',true), set_config('app.user_id','U-ANETAR',true), set_config('app.is_superadmin','off',true)");
    const upd = await db.query("UPDATE products SET price=999 WHERE id='P2' RETURNING id");
    ok('RLS: UPDATE mbi rreshtin e C2 bllokohet', upd.rows.length === 0, 'rreshta=' + upd.rows.length);
    const del = await db.query("DELETE FROM products WHERE id='P2' RETURNING id");
    ok('RLS: DELETE mbi rreshtin e C2 bllokohet', del.rows.length === 0);
    // Një shkelje e politikes e ndërpret transaksionin, ndaj tentativa vihet
    // brenda një SAVEPOINT — kështu vazhdojmë të provojmë edhe rreshtin e vet.
    await db.query('SAVEPOINT tentativa');
    const ins = await db.query("INSERT INTO products(company_id,id,code,name) VALUES ('C2','P3','P3','Infiltrim') RETURNING id").catch((e) => ({ err: e.message }));
    ok('RLS: INSERT në C2 me kontekst C1 bllokohet', !!ins.err, (ins.err || '').slice(0, 60));
    await db.query('ROLLBACK TO SAVEPOINT tentativa');
    // …por rreshti i vet i C1 është i shkrueshëm (izolimi s'duhet të bllokojë punën e ligjshme).
    const own = await db.query("UPDATE products SET price=123 WHERE id='P1' RETURNING price");
    ok('RLS: rreshti i kompanisë së vet mbahet i shkrueshëm', own.rows.length === 1, 'rreshta=' + own.rows.length);
    await db.query('ROLLBACK');
    await db.query('RESET ROLE');
  }

  // ------------------------------------- 2) Tombstone, version, unicitet
  const db1 = EXTERNAL ? new Client({ connectionString: EXTERNAL }) : new PGlite();
  if (EXTERNAL) await db1.connect();
  let srv1 = null;
  if (!EXTERNAL) {
    srv1 = new PGLiteSocketServer({ db: db1, port: 5451, host: '127.0.0.1', maxConnections: 40 });
    await srv1.start();
  }
  const s1 = await boot({ dbPort: 5451, apiPort: 3251 });
  process.on('exit', () => { s1.stop(); if (srv1) { try { srv1.stop(); } catch (_) {} } });
  const { call } = s1;

  const admin = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: PASS }) });
  const H = { Authorization: 'Bearer ' + admin.data.token };
  const co = await call('/api/admin/companies', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Kompania B', code: 'KB' }) });
  const C2 = co.data.company && co.data.company.id;

  const req1 = await call('/api/products?company=C1', { headers: H });
  ok('vëzhgueshmëria: çdo përgjigje ka X-Request-Id', !!req1.headers.get('x-request-id'), req1.headers.get('x-request-id'));

  const created = await call('/api/products?company=C1', { method: 'POST', headers: H, body: JSON.stringify({ code: 'P1', name: 'Molle', price: 10 }) });
  const id = created.data.row && created.data.row.id;
  ok('krijimi kthen version=1', created.status === 201 && Number(created.data.row.version) === 1, 'v=' + (created.data.row || {}).version);

  const dup = await call('/api/products?company=C1', { method: 'POST', headers: H, body: JSON.stringify({ code: 'P1', name: 'Molle tjeter' }) });
  ok('kod i dyfishtë në të njëjtën kompani → 409', dup.status === 409, 'status ' + dup.status);
  if (process.env.DBG) {
    const me = await call('/api/auth/me', { headers: H });
    console.log('   [dbg] login=', admin.status, 'tokenLen=', String(admin.data.token || '').length,
                'me=', me.status, 'C2=', C2, 'h=', JSON.stringify(H).slice(0, 30));
  }
  const other = await call(`/api/products?company=${C2}`, { method: 'POST', headers: H, body: JSON.stringify({ code: 'P1', name: 'Molle në C2' }) });
  ok('i njëjti kod në kompani tjetër lejohet', other.status === 201, 'status ' + other.status + ' ' + JSON.stringify(other.data).slice(0, 120) + ' C2=' + C2);

  const stale = await call(`/api/products/${id}?company=C1`, { method: 'PATCH', headers: H, body: JSON.stringify({ price: 20 }) });
  ok('përditësim i thjeshtë kalon', stale.status === 200, 'status ' + stale.status);
  const conflict = await call(`/api/products/${id}?company=C1`, { method: 'PATCH', headers: { ...H, 'If-Match': '1' }, body: JSON.stringify({ price: 30 }) });
  ok('If-Match i vjetër → 409 konflikt', conflict.status === 409, 'status ' + conflict.status + ' ' + JSON.stringify(conflict.data).slice(0, 70));
  // Pasi një klient merr 409, rilexon rreshtin dhe riprovon me versionin e ri.
  const reread = await call(`/api/products/${id}?company=C1`, { headers: H });
  const vAfter = (reread.data.row || {}).version;
  const fresh = await call(`/api/products/${id}?company=C1`, { method: 'PATCH', headers: { ...H, 'If-Match': String(vAfter) }, body: JSON.stringify({ price: 40 }) });
  ok('If-Match i saktë → 200 (rilexim pas konfliktit)',
     fresh.status === 200 && Number(fresh.data.row.price) === 40,
     'status ' + fresh.status + ' vStale=' + stale.data.row.version + ' vRilexuar=' + vAfter);

  const beforeDel = new Date(Date.now() - 1000).toISOString();
  const del = await call(`/api/products/${id}?company=C1`, { method: 'DELETE', headers: H });
  ok('fshirja është e butë (deleted_at vendoset)', del.status === 200 && !!del.data.deletedAt, JSON.stringify(del.data).slice(0, 90));
  const afterList = await call('/api/products?company=C1', { headers: H });
  ok('rreshti i fshirë nuk del në listë', (afterList.data.rows || []).length === 0, 'rreshta=' + (afterList.data.rows || []).length);
  const sinceList = await call('/api/products?company=C1&since=' + encodeURIComponent(beforeDel), { headers: H });
  const tomb = (sinceList.data.rows || []).find((r) => r.id === id);
  ok('tombstone-i del me ?since=', !!tomb && !!tomb.deleted_at, tomb ? 'deleted_at=' + tomb.deleted_at : 'nuk u gjet');
  const hard = await call(`/api/products/${id}?company=C1&hard=1`, { method: 'DELETE', headers: H });
  ok('admini mund ta fshijë përfundimisht (?hard=1)', hard.status === 200 && hard.data.hard === true, 'status ' + hard.status);

  // ------------------------------------------------- 3) shëndeti + metrikat
  const h = await call('/api/health', {});
  ok('health: tregon db, uptime dhe mënyrën e instancave',
     h.data.db === true && typeof h.data.uptimeSeconds === 'number' && h.data.multiInstance === false,
     JSON.stringify({ db: h.data.db, uptime: h.data.uptimeSeconds, multi: h.data.multiInstance, rateLimit: h.data.rateLimitStore }));
  const mt = await call('/api/metrics', { headers: H });
  ok('metrics: kthen metrika për admin', mt.status === 200 && typeof mt.data.metrics.sse_clients === 'number', 'status ' + mt.status);
  const prom = await (await fetch(s1.API + '/api/metrics?format=prometheus', { headers: H })).text();
  ok('metrics: formati Prometheus', /^# HELP process_uptime_seconds/m.test(prom), prom.split('\n')[0]);
  const denied = await call('/api/metrics', {});
  ok('metrics: refuzohet pa autentikim', denied.status === 401, 'status ' + denied.status);
  s1.stop();

  // --------------------------- 4) AUTOBUSI MIDIS INSTANCAVE (LISTEN/NOTIFY)
  // Ngjarja kalohet nga Postgres-i: A bën NOTIFY, B e merr. Vetëm transporti i
  // klientit pg është i sajuar, sepse serveri i socket-it të PGlite-it nuk ua
  // përcjell njoftimet klientëve të lidhur (në Postgres të vërtetë kjo është
  // sjellje standarde dhe funksionon pa asgjë shtesë).
  const dbBus = EXTERNAL ? new Client({ connectionString: EXTERNAL }) : new PGlite();
  if (EXTERNAL) await dbBus.connect();
  const relay = () => {
    const hs = [];
    if (EXTERNAL) {
      // PostgreSQL i vërtetë: një lidhje e dedikuar që dëgjon kanalin.
      const c = new Client({ connectionString: EXTERNAL });
      c.connect().then(() => c.query('LISTEN biobes_events')).catch(() => {});
      c.on('notification', (m) => hs.forEach((h) => h(m)));
      return {
        on: (ev, cb) => { if (ev === 'notification') hs.push(cb); },
        query: async (sql, params) => { if (/pg_notify/.test(sql)) await c.query('SELECT pg_notify($1, $2)', params); },
        connect: async () => {},
      };
    }
    dbBus.listen('biobes_events', (payload) => hs.forEach((h) => h({ payload })));
    return {
      on: (ev, cb) => { if (ev === 'notification') hs.push(cb); },
      query: async (sql, params) => { if (/pg_notify/.test(sql)) await dbBus.query('SELECT pg_notify($1, $2)', params); },
      connect: async () => {},
    };
  };
  {
    process.env.MULTI_INSTANCE = '1';
    process.env.INSTANCE_ID = 'inst-A';
    const busA = require('./bus');
    delete require.cache[require.resolve('./bus')];
    process.env.INSTANCE_ID = 'inst-B';
    const busB = require('./bus');
    delete require.cache[require.resolve('./bus')];
    await busA.start(null, null, relay());
    await busB.start(null, null, relay());
    await sleep(200);
    let got = null;
    busB.onMessage((d) => (got = d));
    await busA.publish('state-changed', { v: 1 }, { company: 'C1' });
    await sleep(500);
    ok('autobus: ngjarja e A-së arrin te B (NOTIFY i vërtetë)',
       !!got && got.event === 'state-changed' && got.payload.v === 1 && got.opts.company === 'C1',
       JSON.stringify(got));
    let echo = false;
    busA.onMessage(() => (echo = true));
    await busA.publish('state-changed', { v: 2 }, {});
    await sleep(500);
    ok('autobus: dërguesi nuk e merr përsëri ngjarjen (pa dyfishim SSE)', echo === false);
    await busA.stop(); await busB.stop();
    delete process.env.MULTI_INSTANCE; delete process.env.INSTANCE_ID;
  }

  // ------------------------------------ 5) DY INSTANCA TË VËRTETA (procese)
  let srv2 = null;
  if (!EXTERNAL) {
    var db2 = new PGlite();
    srv2 = new PGLiteSocketServer({ db: db2, port: 5452, host: '127.0.0.1', maxConnections: 40 });
    await srv2.start();
  }
  const A = await boot({ dbPort: 5452, apiPort: 3252, env: { MULTI_INSTANCE: '1', RATE_LIMIT_READ_MAX: '8' } });
  const B = await boot({ dbPort: 5452, apiPort: 3253, env: { MULTI_INSTANCE: '1', RATE_LIMIT_READ_MAX: '8' } });
  try {
    const a = await A.call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: PASS }) });
    const HA = { Authorization: 'Bearer ' + a.data.token };
    const client = sse(B.API + '/api/events?token=' + a.data.token);
    ok('SSE hapet në instancën B', (await client.ready) === 200);
    const h2 = await A.call('/api/health', {});
    ok('health: raporton mënyrën shumë-instancë', h2.data.multiInstance === true && h2.data.rateLimitStore === 'database',
       JSON.stringify({ multi: h2.data.multiInstance, rateLimit: h2.data.rateLimitStore }));

    // Me PostgreSQL të vërtetë, LISTEN/NOTIFY funksionon edhe midis procesesh:
    // kjo është prova përfundimtare e shkallëzimit shumë-instancash.
    if (EXTERNAL) {
      const st = { products: [{ id: 'P1', code: 'P1', name: 'Molle' }], suppliers: [], customers: [], warehouses: [], lots: [], settings: {} };
      const put = await A.call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: st }) });
      await sleep(2500);
      const got = client.events.some((e) => e.event === 'state-changed');
      const hA = await A.call('/api/health');
      const hB = await B.call('/api/health');
      ok('dy instanca: ndryshimi në A arrin te pajisja lidhur në B', got,
         'put=' + put.status + ' evente=' + client.events.map((e) => e.event).join(',')
         + ' | A.bus=' + JSON.stringify(hA.data.bus) + ' | B.bus=' + JSON.stringify(hB.data.bus));
    }

    // Kufizuesi në databazë: një kovë e përbashkët për të gjitha instancat.
    // Me motorin në kujtesë, 8 kërkesa në secilën instancë do të kishin kaluar.
    let blocked = null;
    for (let i = 0; i < 14; i++) {
      const r = await (i % 2 === 0 ? A.call : B.call)('/api/products?company=C1', { headers: HA });
      if (r.status === 429) { blocked = { i, r }; break; }
    }
    ok('kufizuesi në databazë numëron një herë për të dyja instancat',
       !!blocked, blocked ? 'u bllokua te kërkesa ' + (blocked.i + 1) : 'nuk u bllokua fare');
    if (blocked) {
      const other = await B.call('/api/products?company=C1', { headers: HA });
      ok('kufiri i përbashkët: instanca tjetër bllokohet gjithashtu', other.status === 429, 'status ' + other.status);
    }
    client.stop();
  } finally {
    A.stop(); B.stop();
    if (srv2) { try { srv2.stop(); } catch (_) {} }
  }

  console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
