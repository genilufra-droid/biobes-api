// Test multi-company: 2 kompani të izoluara, 2 user-a, CRUD produkteve,
// dhe izolimi i plotë (produkti i kompanisë A nuk i del kompanisë B).
const { spawn } = require('child_process');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const DB_PORT = 5435;
const API_PORT = 3203;
const API = `http://127.0.0.1:${API_PORT}`;
const PASS = 'admin12345';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let child, srv;
  const db = new PGlite();
  srv = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1', maxConnections: 8 });
  await srv.start();
  child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(API_PORT), DATABASE_URL: 'postgres://biobes:biobes@127.0.0.1:'+DB_PORT+'/biobes',
           ADMIN_USERNAME:'admin', ADMIN_PASSWORD:PASS, SESSION_TTL_HOURS:'24', PGSSLMODE:'disable' },
    stdio: ['ignore','pipe','pipe'],
  });

  // Pastrim i garantuar: nëse testi dështon në mes, procesi i serverit dhe
  // PGlite-i mbeteshin gjallë dhe zinin portat (3202/3203, 5434/5435).
  const cleanup = () => { try { child.kill('SIGKILL'); } catch (_) {} try { srv.stop().catch(() => {}); } catch (_) {} };
  process.on('exit', cleanup);
  let logs = '';
  child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);

  const call = async (p, opts = {}) => {
    const r = await fetch(API + p, { ...opts, headers: { 'Content-Type':'application/json', ...(opts.headers||{}) } });
    return { status: r.status, ok: r.ok, data: await r.json().catch(()=>({})) };
  };
  const login = async (u,pw) => call('/api/auth/login',{method:'POST',body:JSON.stringify({username:u,password:pw})});
  for (let i = 0; i < 200; i++) { try { if ((await call('/api/health')).ok) break; } catch(_){} await sleep(200); }

  const admin = await login('admin', PASS);
  ok('admin-login', admin.ok);
  const HA = { Authorization: 'Bearer ' + admin.data.token };

  // Krijojmë 2 kompani.
  const c1 = await call('/api/admin/companies', { method:'POST', headers:HA, body:JSON.stringify({name:'Kompania A', code:'KA', currency:'ALL'}) });
  ok('create-co-a', c1.ok && c1.data.company, JSON.stringify(c1.data));
  const c2 = await call('/api/admin/companies', { method:'POST', headers:HA, body:JSON.stringify({name:'Kompania B', code:'KB', currency:'EUR'}) });
  ok('create-co-b', c2.ok && c2.data.company);
  const COA = c1.data.company.id;
  const COB = c2.data.company.id;

  // Lista e kompanive i përmban të dyja (main krijon edhe C1 të parazgjedhur).
  const lst = await call('/api/admin/companies', { headers:HA });
  const ids = (lst.data.companies || []).map((c) => c.id);
  ok('companies-list-has-a-b', lst.ok && ids.includes(COA) && ids.includes(COB), 'ids=' + ids.join(','));

  // Krijoj produkt në KO A.
  const p1 = await call('/api/products', { method:'POST', headers:{...HA, 'X-Company-Id':COA},
    body:JSON.stringify({code:'P1', name:'Molle A', price:100}) });
  ok('create-product-a', p1.ok && p1.data.row && p1.data.row.company_id === COA, JSON.stringify(p1.data));

  // Krijoj produkt në KO B.
  const p2 = await call('/api/products', { method:'POST', headers:{...HA, 'X-Company-Id':COB},
    body:JSON.stringify({code:'P1', name:'Molle B', price:200}) });
  ok('create-product-b-same-code-ok', p2.ok && p2.data.row.company_id === COB);

  // Lexoj vetëm produktet e A.
  const la = await call('/api/products', { headers:{...HA, 'X-Company-Id':COA} });
  ok('list-a-only-1', la.ok && la.data.total === 1 && la.data.rows[0].name==='Molle A',
     'rows=' + la.data.rows.map(r=>r.name).join(','));

  // Lexoj vetëm produktet e B.
  const lb = await call('/api/products', { headers:{...HA, 'X-Company-Id':COB} });
  ok('list-b-only-1', lb.ok && lb.data.total === 1 && lb.data.rows[0].name==='Molle B',
     'rows=' + lb.data.rows.map(r=>r.name).join(','));

  // Wipe e kompanisë A nuk prek B.
  const wipe = await call('/api/admin/company/'+COA+'/wipe', { method:'POST', headers:HA, body:JSON.stringify({password:PASS}) });
  ok('wipe-a', wipe.ok, JSON.stringify(wipe.data));
  const laAfter = await call('/api/products', { headers:{...HA, 'X-Company-Id':COA} });
  ok('a-empty-after-wipe', laAfter.ok && laAfter.data.total === 0);
  const lbAfter = await call('/api/products', { headers:{...HA, 'X-Company-Id':COB} });
  ok('b-untouched', lbAfter.ok && lbAfter.data.total === 1 && lbAfter.data.rows[0].name==='Molle B');

  // SSE merr event për kompani nëse është ajo kompani.
  const sse = [];
  await new Promise((resolve) => {
    const u = new URL(API + '/api/events'); u.searchParams.set('token', admin.data.token);
    fetch(u.toString()).then((resp) => {
      const r = resp.body.getReader(); const d = new TextDecoder(); let buf='';
      const pump = async () => {
        while (true) {
          const { done, value } = await r.read(); if (done) break;
          buf += d.decode(value, { stream: true });
          const parts = buf.split('\n\n'); buf = parts.pop();
          for (const pt of parts) {
            const m = pt.match(/^event:\s*(\S+).*?^data:\s*(\{.*\})/ms);
            if (m) sse.push({ event:m[1], data: JSON.parse(m[2]) });
          }
          if (sse.some(e => e.event === 'entity-changed')) { try{r.cancel();}catch(_){} resolve(); return; }
        }
      }; pump();
      setTimeout(async () => {
        await call('/api/products', { method:'POST', headers:{...HA, 'X-Company-Id':COB},
          body:JSON.stringify({code:'P3', name:'Dardha B', price:50}) });
      }, 500);
      setTimeout(resolve, 5000);
    }).catch(resolve);
  });
  ok('sse-received-entity-changed', sse.some(e => e.event === 'entity-changed'),
     'events=' + sse.map(e=>e.event).join(','));

  console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
  child.kill('SIGTERM'); srv.stop().catch(()=>{});
  if (fail) { console.log('\n--- LOGS ---\n' + logs.slice(-500)); }
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('FAIL:', e);
  console.log('--- LOGS ---\n' + String(typeof logs !== 'undefined' ? logs : '').slice(-1500));
  try { if (child) child.kill('SIGKILL'); } catch (_) {}
  try { if (srv) srv.stop().catch(() => {}); } catch (_) {}
  process.exit(1);
});
