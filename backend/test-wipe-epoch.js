// BioBes API — persistent wipe epoch regression.
const { spawn } = require('child_process');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const DB_PORT = 5435, API_PORT = 3202, API = `http://127.0.0.1:${API_PORT}`;
const ADMIN='admin', PASS='admin12345';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0; const ok=(n,c,e='')=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n+(e?' — '+e:''));};
(async()=>{
 const db=new PGlite(); const ds=new PGLiteSocketServer({db,port:DB_PORT,host:'127.0.0.1',maxConnections:8}); await ds.start();
 const child=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:String(API_PORT),DATABASE_URL:`postgres://biobes:biobes@127.0.0.1:${DB_PORT}/biobes`,ADMIN_USERNAME:ADMIN,ADMIN_PASSWORD:PASS,SESSION_TTL_HOURS:'24',PGSSLMODE:'disable'},stdio:['ignore','pipe','pipe']});
 let log=''; child.stdout.on('data',d=>log+=d); child.stderr.on('data',d=>log+=d);
 async function call(path,opts={}){const r=await fetch(API+path,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});return{status:r.status,ok:r.ok,data:await r.json().catch(()=>({}))};}
 try{
  let h; for(let i=0;i<60;i++){try{h=await call('/api/health');if(h.ok&&h.data.db)break}catch{} await sleep(250)} ok('server-booted',!!(h&&h.ok&&h.data.db));
  const l=await call('/api/auth/login',{method:'POST',body:JSON.stringify({username:ADMIN,password:PASS})}); ok('admin-login',l.ok&&!!l.data.token); if(!l.ok)throw new Error('login');
  const H={Authorization:'Bearer '+l.data.token};
  const s0={products:[],suppliers:[],customers:[{id:'OLD',code:'OLD',name:'Old',balance:0}],warehouses:[],lots:[],weighings:[],purchaseInvoices:[],salesInvoices:[],orders:[],payments:[],customerPayments:[],users:[]};
  const init=await call('/api/state',{method:'PUT',headers:H,body:JSON.stringify({state:s0,baseVersion:0})}); ok('initial-state-v1',init.ok&&init.data.version===1);
  const wipe=await call('/api/admin/wipe',{method:'POST',body:JSON.stringify({password:PASS})}); const epoch=wipe.data.wipedAt; ok('wipe-created-epoch',wipe.ok&&!!epoch,JSON.stringify(wipe.data));
  const afterWipe=await call('/api/state',{headers:H}); ok('state-empty-after-wipe',afterWipe.ok&&afterWipe.data.version===0&&afterWipe.data.state===null); ok('get-exposes-epoch',afterWipe.data.wipedAt===epoch);
  const staleNoAck=await call('/api/state',{method:'PUT',headers:H,body:JSON.stringify({state:s0,baseVersion:1})}); ok('stale-device-no-ack-blocked',staleNoAck.status===409&&staleNoAck.data.wiped===true);
  const fresh={...s0,customers:[{id:'NEW',code:'NEW',name:'New',balance:0}]};
  const freshPut=await call('/api/state',{method:'PUT',headers:H,body:JSON.stringify({state:fresh,baseVersion:0,wipeAck:epoch})}); ok('fresh-device-ack-init',freshPut.ok&&freshPut.data.version===1,JSON.stringify(freshPut.data));
  const afterFresh=await call('/api/state',{headers:H}); ok('epoch-persists-after-first-write',afterFresh.ok&&afterFresh.data.wipedAt===epoch,JSON.stringify(afterFresh.data.wipedAt));
  const next={...fresh,suppliers:[{id:'S1',code:'S1',name:'Supplier',balance:0}]};
  const second=await call('/api/state',{method:'PUT',headers:H,body:JSON.stringify({state:next,baseVersion:1,wipeAck:epoch})}); ok('same-ack-next-write-ok',second.ok&&second.data.version===2,JSON.stringify(second.data));
  const afterSecond=await call('/api/state',{headers:H}); ok('epoch-persists-after-later-write',afterSecond.data.wipedAt===epoch);
  const resurrect={...s0,customers:[{id:'RESURRECT',code:'R',name:'Stale resurrect',balance:0}]};
  const staleCurrentVersion=await call('/api/state',{method:'PUT',headers:H,body:JSON.stringify({state:resurrect,baseVersion:2})}); ok('stale-device-current-version-still-blocked',staleCurrentVersion.status===409&&staleCurrentVersion.data.wiped===true,'HTTP '+staleCurrentVersion.status);
  const final=await call('/api/state',{headers:H}); ok('stale-data-never-resurrected',final.ok&&!(final.data.state.customers||[]).some(x=>x.id==='RESURRECT'));
  console.log(`\n${pass} PASS, ${fail} FAIL`); if(fail){console.log(log.split('\n').slice(-25).join('\n'));process.exitCode=1;}
 } finally {child.kill('SIGTERM');await ds.stop();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
