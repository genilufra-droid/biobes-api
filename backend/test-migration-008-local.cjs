// Test lokal i migrimit 008 mbi një bazë EKZISTUESE (PGlite = Postgres i vërtetë në WASM).
// Verifikon: gjendja ekzistuese, epoka e wipe-it, backup-et, auditimi dhe grupet e përdoruesit
// kalojnë të paprekura në kompaninë e parë (C1); migrimi është idempotent dhe lë kopje sigurie.
const fs=require('fs'),path=require('path');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const db=new PGlite();let pass=0,fail=0;
 const ok=(n,c,x='')=>{c?pass++:fail++;console.log((c?'PASS':'FAIL')+' '+n+(x?' — '+x:''))};
 const dir=path.join(__dirname,'migrations');
 const files=fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
 // 1) apliko vetëm deri në 007 (baza "e sotme", pa multi-company)
 await db.exec(fs.readFileSync(path.join(dir,'001_initial.sql'),'utf8'));
 await db.query("INSERT INTO users(id,username,name,role,password_hash) VALUES('USR-ADMIN','admin','Administrator','ROLE-ADMIN','x')");
 // (Vetëm deri në 007: 008 është vetë objekti i provës dhe çdo migrim më i ri
 //  — p.sh. 009_company_domain.sql — supozon skemën që krijon 008.)
 for(const f of files){if(f==='001_initial.sql'||f>='008_companies.sql')continue;await db.exec(fs.readFileSync(path.join(dir,f),'utf8'))}
 // 2) të dhëna reale: gjendje, backup, audit, shenja e wipe-it, grupe përdoruesi
 const st={products:[{id:'P1',code:'P1'}],suppliers:[{id:'S1',code:'S1'}],customers:[{id:'C1x',code:'C1x'}],lots:[],settings:{companyName:'BioBes Sh.p.k.'}};
 await db.query("INSERT INTO app_state(id,data,version,updated_at) VALUES('main',$1::jsonb,42,NOW())",[JSON.stringify(st)]);
 await db.query("INSERT INTO meta(key,value) VALUES('wiped_at','2026-09-01 10:00:00+00')");
 await db.query("INSERT INTO backups(label,taken_by,state_version,size_bytes,payload) VALUES('para-ndryshimit','admin',41,10,'{}'::jsonb)");
 await db.query("INSERT INTO audit_log(actor,action,detail) VALUES('admin','STATE_PUT','version 42')");
 await db.query("INSERT INTO user_groups(user_id,group_id) VALUES('USR-ADMIN','GRP-SET-ADMIN') ON CONFLICT DO NOTHING");
 // 3) migrimi 008
 await db.exec(fs.readFileSync(path.join(dir,'008_companies.sql'),'utf8'));
 const st8=await db.query("SELECT id,company_id,version,data FROM app_state");
 ok('rreshti ekzistues u bë C1 me gjithë të dhënat', st8.rows.length===1&&st8.rows[0].id==='C1'&&st8.rows[0].company_id==='C1'&&st8.rows[0].version===42&&st8.rows[0].data.products[0].id==='P1', JSON.stringify(st8.rows[0]));
 const co=await db.query("SELECT id,code,name FROM companies");
 ok('kompania e parë u krijua', co.rows.length===1&&co.rows[0].id==='C1', JSON.stringify(co.rows));
 const uc=await db.query("SELECT user_id,company_id,is_default FROM user_companies");
 ok('admini u bë anëtar i C1 (default)', uc.rows.length===1&&uc.rows[0].is_default===true);
 const bk=await db.query("SELECT company_id FROM backups WHERE label='para-ndryshimit'");
 ok('backup-i ekzistues u shenjua me C1', bk.rows[0].company_id==='C1');
 const au=await db.query("SELECT company_id FROM audit_log WHERE action='STATE_PUT'");
 ok('zëri i auditimit u shenjua me C1', au.rows[0].company_id==='C1');
 const wk=await db.query("SELECT key FROM meta WHERE key LIKE 'wiped_at%'");
 ok('epoka e wipe-it kaloi në wiped_at:C1', wk.rows.length===1&&wk.rows[0].key==='wiped_at:C1', JSON.stringify(wk.rows));
 const ug=await db.query("SELECT company_id FROM user_groups");
 ok('grupet e përdoruesit ruhen (company_id bosh = të gjitha)', ug.rows.length===1&&ug.rows[0].company_id===null);
 // 4) idempotenca: ekzekuto përsëri
 const before=JSON.stringify((await db.query('SELECT * FROM app_state')).rows);
 await db.exec(fs.readFileSync(path.join(dir,'008_companies.sql'),'utf8'));
 const after=JSON.stringify((await db.query('SELECT * FROM app_state')).rows);
 ok('migrimi i dytë nuk ndryshon asgjë', before===after);
 ok('kopja e sigurisë u krijua', (await db.query('SELECT COUNT(*)::int c FROM app_state_bak_008')).rows[0].c===1);
 console.log('\n'+pass+' PASS, '+fail+' FAIL');
 process.exit(fail?1:0);
})();
