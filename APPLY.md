# Kit-i i zbatueshëm për `biobes-api` — P1 / P2 / P3 (backend)

> **Çfarë është ky dosje?** Ky është një **kit transferimi** i përgatitur në repo-n
> `biobes-erp` (degë `arena/01a0caf7-biobes-erp`) që sesioni i ri i `biobes-api`
> ta marrë dhe ta zbatojë **pa e rindërtuar nga përshkrimi**. Përmban migrime SQL,
> module Node dhe prova vendore — të gjitha **shtuese** (additive): asnjë format,
> model ose UI nuk ridizajnohet.
>
> **Pse këtu dhe jo në `biobes-api`?** Sepse ky sesion është i lidhur vetëm me degën
> `arena/01a0caf7-biobes-erp` të `biobes-erp`. Skedarët duhen **kopjuar** në repo-n
> e backend-it (shih «Renditja e zbatimit» më poshtë).
>
> **Rregulli i pandryshueshëm:** KURRË mos e ekzekuto `npm run test:live` kundër
> `biobes-api.onrender.com` — e **shuan** databazën. Provat bëhen vetëm vendore
> (PGlite) ose kundër një Postgres-i zhvillimi. LIVE verifikohet vetëm me GET lexues.

---

## 1) Gjendja e verifikuar e `biobes-api` (2026-09-22)

| Burimi | Gjendja |
|---|---|
| `main` | `f9590ff` — **pa** rishkrimin multi-company (PR #9 nuk u bashkua) |
| dega `arena/01a0be23-biobes-api` | `0ca0ccc` — përmban `migrations/007_multi_company.sql` |
| PR #9 | **CLOSED, i pabashkuar** (Faza 1/2/3 cloud: 007, middleware kompanie, wipe për kompani, `broadcastCompanyEvent`, `render.yaml` `SYNC_ALL_MODULES`, 48 prova vendore, `srv-local.js` PGlite) |
| LIVE `/api/health` | `{ok:true, db:true, version:1, syncPolicy:"all-modules", defaultCompany:"C1", companies:3}` |
| LIVE `/api/manual` | `{ok:false, error:"Endpoint i panjohur"}` ← **mungon** |
| LIVE `/api/export/xlsx?module=customerReturns` | `{ok:false, error:"Endpoint i panjohur"}` ← **mungon** |
| `backend/package.json` | varësi: `express`, `nodemailer`, `pg`; dev: `@electric-sql/pglite`, `pglite-socket` — **NUK ka** `jsonwebtoken`, `bcrypt`, `helmet`, `xlsx` |
| `backend/db.js` | `getPool()` (max 10, idle 30 s, `sslConfig` me `PG_CA_CERT`/`PGSSLMODE`) + `dbOk()` — **pa** RLS, **pa** `SET app.company_id` |
| `ac6bfc5` | **nuk ekziston** në GitHub (422) — kodi i vjetër P1/P2/P3 është humbur |

**Pasojë praktike:** kit-i është shkruar **pa varësi të reja** (JWT/scrypt/XLSX/headerë
sigurie me `node:crypto` + `node:zlib` + Express të pastër), prandaj `npm install` nuk
nevojitet. Nëse dëshiron `jsonwebtoken`/`bcrypt`/`helmet`/`xlsx`, shih §7.

---

## 2) Vendimi i bazës: `main` apo `arena/01a0be23-biobes-api`?

Kit-i është **i pavarur nga baza** (SQL idempotent + module shtuese), por integrimi
në `server.js` ndryshon:

| Baza | Çfarë ke | Çfarë duhet bërë |
|---|---|---|
| **`main` (`f9590ff`)** | skemë një-kompani (migrime deri 008), `server.js` me `app_state` JSONB | zbatoni **së pari** `007_multi_company.sql` nga dega arena (ose cherry-pick PR #9), pastaj kit-in |
| **`arena/01a0be23-biobes-api` (`0ca0ccc`)** | 007 i aplikuar, middleware kompanie, wipe për kompani, 48 prova | zbatoni kit-in **drejtpërdrejt** (rekomanduar) |

**Rekomandim:** puno nga dega `arena/01a0be23-biobes-api` (ose ri-hap PR #9) — aty
është skema multi-company që frontend-i i `biobes-erp` tashmë e pret
(`company_id` kudo, `company_sync`, `company_wipe_epoch`, `user_sessions_active`).

Numërimi i kit-it fillon nga **009** sepse në degën arena ekzistojnë deri në **007**
(dhe në `main` deri në **008**). Nëse baza jote ndryshon, riemëro skedarët e
migrimeve sipas radhës ekzistuese (përmbajtja nuk ndryshon).

---

## 3) Përmbajtja e kit-it

```
biobes-api-kit/
├── APPLY.md                              ← ky dokument
└── backend/
    ├── migrations/
    │   ├── 009_rls.sql                   ← P2: izolim 100% në nivel databaze (FORCE RLS)
    │   ├── 010_p3_indexes.sql            ← P3: indekse për 20 përdorues + UNIQUE numrat
    │   ├── 011_doc_sequences.sql         ← P2: doc_sequences + doc_numbers_used (FOR UPDATE)
    │   ├── 012_refresh_tokens.sql        ← P1: refresh tokenë të revokueshëm (hash në server)
    │   └── 013_app_role.sql              ← !!! parakushti i RLS: roli JO-superuser + privilegjet
    ├── lib/
    │   ├── pgCompany.js                  ← konteksti SET LOCAL për ÇDO transaksion + middleware anëtarësie
    │   ├── token.js                      ← JWT HS256 + scrypt, pa varësi
    │   ├── sequences.js                  ← numra dokumentesh të sigurt (nextNumber / reserveNumber)
    │   ├── advisoryLock.js               ← dryer për backup/punë që nuk duhet të dyfishohen
    │   └── xlsx.js                       ← shkrues .xlsx (ZIP me dorë), slice(20) + numFmt
    ├── middleware/
    │   └── security.js                   ← headerë sigurie + CORS multi-origin + rate limit
    ├── routes/
    │   └── manual.js                     ← GET /api/manual (dhe /api/manual/:moduleId)
    ├── test-kit-local.cjs                ← 15 prova vendore (PGlite): RLS, sekuenca, XLSX, JWT
    ├── test-concurrency-local.cjs        ← prova e garës me 20 lidhje të vërteta (pg.Pool)
    └── .env.example.additions            ← variablat e reja për .env / Render
tools/
└── extract-kit.cjs                       ← rikthen skedarët nga KIT-BIOBES-API-P1-P2-P3.md (bajt-për-bajt)
```

**Çfarë është provuar tashmë në këtë sesion** (me PGlite 0.5.8, `node backend/test-kit-local.cjs`
→ **15/15 kaluan, 0 dështuan**):

- **RLS izolimi i vërtetë**: C1 sheh vetëm produktet e veta; C2 vetëm të vetat; një
  përdorues i C1 me kontekst C2 sheh **0 rreshta**; `INSERT` me `company_id` të huaj
  **refuzohet** nga politika; `DELETE` nuk prek kompaninë tjetër; superadmin sheh të
  gjitha. Konteksti `SET LOCAL` **nuk rrjedh** në transaksionin pasardhës (pool reuse).
- **Migrimet SQL ekzekutohen pa gabim**: `009`, `010`, `011`, `012`, `013` (idempotente).
- **Sekuenca**: 30 kërkesa → 30 numra unikë `FSH-2026-0001…0030`; numërim i ndarë për
  kompani (C2 fillon nga 0001); numër i zënë → `{conflict:true, nextNumber}`; numër i
  lirë pranohet dhe e ngre sekuencën.
- **XLSX**: 45 rreshta → **3 faqe** (20+20+5), arkiv ZIP i vlefshëm
  (`[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/styles.xml`,
  `sheet1..3.xml`), `numFmt` **164** (`#,##0.00`), **165** (`#,##0.000`), **14** (datë),
  rreshti **SHUMA**, kokë e ngrirë, `autoFilter`.
- **JWT/scrypt**: nënshkrim + verifikim HS256, refuzim i tamperimit, `TokenExpiredError`,
  refuzim i llojit të gabuar, `jti` për refresh, hash `scrypt$…` + verifikim, `hashToken` (sha256).
- **Advisory lock**: dryeri merret, funksioni ekzekutohet, çelësi është deterministik.

**Zbulimi më i rëndështëm i këtij sesioni:** provat e RLS **dështuan në fillim** sepse
PGlite lidhet si `postgres` (SUPERUSER) dhe PostgreSQL **nuk e zbaton RLS për superuser-in,
madje as me `FORCE ROW LEVEL SECURITY`**. E njëjta gjë rrezikon edhe prodhimin (Aiven
`avnadmin`, Neon, etj.). Zgjidhja është `migrations/013_app_role.sql` + `APP_DB_ROLE`
(shih §5, pika 1). Pa këtë, izolimi do të ishte vetëm në letër.

---

## 4) Renditja e zbatimit (10 hapa)

1. **Degë e re** nga baza e zgjedhur: `git checkout -b feat/cloud-p1-p2-p3`.
2. **Kopjo skedarët** e kit-it në vendet e duhura (ruaj shtigjet relative):
   ```bash
   # nga repo-ja biobes-api
   cp -r <kit>/backend/migrations/0{09,10,11,12,13}_*.sql backend/migrations/
   cp -r <kit>/backend/lib backend/
   cp -r <kit>/backend/middleware backend/
   cp -r <kit>/backend/routes backend/
   cp <kit>/backend/test-kit-local.cjs backend/
   cat <kit>/backend/.env.example.additions >> backend/.env.example
   ```
3. **Migrimet në nisje** (`RUN_MIGRATIONS_ON_START=true`): sigurohu që rendi i
   skedarëve është alfabetik (`001…013`) dhe që çdo migrim aplikohet **një herë**
   (tabela `schema_migrations` ose ekuivalente). Migrimet duhet të ecin **jashtë**
   `withCompany` (me rolin e seancës, i cili zakonisht ka `BYPASSRLS`) — përndryshe
   RLS e bllokon krijimin e vetë politikave. Pas `013_app_role.sql`, cakto
   `APP_DB_ROLE=biobes_app` në `.env` **dhe** në Render → Environment, përndryshe
   izolimi nuk zbatohet (shih §5, pika 1).
4. **Auth → JWT (P1).** Zëvendëso sesionet e vjetra me dy tokenë:
   ```js
   const { signAccessToken, signRefreshToken, verify, hashToken, verifyPassword } = require('./lib/token');
   const { withSystem } = require('./lib/pgCompany');

   app.post('/api/auth/login', async (req, res) => {
     const { username, password } = req.body || {};
     // login = para-autentikimit → kontekst SISTEM (përndryshe FORCE RLS nuk kthen asgjë)
     const user = await withSystem(async (client) => {
       const r = await client.query('SELECT * FROM users WHERE username = $1', [username]);
       return r.rows[0];
     });
     if (!user || !verifyPassword(password, user.password_hash))
       return res.status(401).json({ ok: false, error: 'Kredencialet nuk përputhen' });

     const companyId = await defaultCompanyFor(user.id);            // nga company_users.is_default
     const access = signAccessToken(user, companyId);
     const jti = crypto.randomUUID();
     const refresh = signRefreshToken(user, jti);
     await withSystem((client) => client.query(
       `INSERT INTO refresh_tokens (id, token_hash, user_id, company_id, expires_at, user_agent, ip)
        VALUES ($1,$2,$3,$4, NOW() + ($5 || ' seconds')::interval, $6, $7)`,
       [jti, hashToken(refresh), user.id, companyId, process.env.JWT_REFRESH_TTL_SECONDS || 604800,
        req.get('user-agent') || '', req.ip || '']));
     res.json({ ok: true, token: access, refreshToken: refresh, expiresIn: 900,
                user: { id: user.id, username: user.username, role: user.role },
                companyId, isSuperadmin: !!user.is_superadmin });
   });

   // middleware i autorizimit
   function auth(req, res, next) {
     const h = req.get('authorization') || '';
     const tok = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
     try {
       const p = verify(tok, 'access');
       req.auth = { userId: p.sub, username: p.username, role: p.role,
                    companyId: p.companyId, isSuperadmin: !!p.isSuperadmin };
       next();
     } catch (e) {
       const code = e.name === 'TokenExpiredError' ? 401 : 401;
       res.status(code).json({ ok: false, error: 'Sesion i pavlefshëm — hyr përsëri', expired: e.name === 'TokenExpiredError' });
     }
   }
   ```
   `POST /api/auth/refresh` lexon `refresh_tokens` me `hashToken`, e rrotullon
   (revoko të vjetrin, lësho të ri) dhe thërret `prune_refresh_tokens()` herë pas here.
5. **Çdo rrugë biznesi → kontekst kompanie (P2).** Asnjë `pool.query(...)` i drejtpërdrejtë
   për të dhëna biznesi; gjithçka kalon nëpër `withCompany`:
   ```js
   const { withCompany, requireCompanyMembership } = require('./lib/pgCompany');

   app.get('/api/products', auth, requireCompanyMembership(), async (req, res) => {
     const rows = await withCompany(req.companyCtx, (client) =>
       client.query('SELECT id, code, name, unit, balance FROM products ORDER BY code').then(r => r.rows));
     res.json({ ok: true, products: rows, company: req.companyId });
   });
   ```
   Vërejtje: `requireCompanyMembership()` vendos `req.companyId` dhe `req.companyCtx`
   (`{companyId, userId, isSuperadmin}`). Leximi i kompanisë: `X-Company-Id` →
   `?company=` → kompania e token-it — **e njëjta** renditje që përdor frontend-i.
6. **Numërimi i dokumenteve (P2).** Në krijimin e faturës/dokumentit:
   ```js
   const { nextNumber, reserveNumber } = require('./lib/sequences');

   app.post('/api/sales-invoices', auth, requireCompanyMembership(), async (req, res) => {
     try {
       const out = await withCompany(req.companyCtx, async (client) => {
         const wanted = req.body.number;               // nëse pajisja e ka zgjedhur vetë
         let number;
         if (wanted) {
           const r = await reserveNumber(client, req.companyId, 'sales_invoice', wanted, { userId: req.auth.userId });
           if (!r.ok && r.conflict) {
             const err = new Error('Numri është i zënë');
             err.status = 409; err.conflict = 'number'; err.number = r.number; err.nextNumber = r.nextNumber;
             throw err;
           }
           number = r.number;
         } else {
           number = await nextNumber(client, req.companyId, 'sales_invoice', { userId: req.auth.userId });
         }
         const ins = await client.query(
           `INSERT INTO sales_invoices (company_id, id, number, customer_id, total, status, items)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
           [req.companyId, req.body.id || crypto.randomUUID(), number, req.body.customerId || '',
            req.body.total || 0, req.body.status || 'draft', JSON.stringify(req.body.items || [])]);
         return ins.rows[0];
       });
       res.status(201).json({ ok: true, invoice: out, number: out.number });
     } catch (e) {
       if (e.status === 409 && e.conflict === 'number')
         return res.status(409).json({ ok: false, conflict: 'number', number: e.number, nextNumber: e.nextNumber,
                                       error: 'Numri është i zënë — aplikacioni do të marrë numrin tjetër' });
       if (e.status) return res.status(e.status).json({ ok: false, error: e.message });
       console.error(e); res.status(500).json({ ok: false, error: 'Gabim gjatë ruajtjes' });
     }
   });
   ```
   **Kontrata 409** është ajo që frontend-i (`biobes-erp/index.html`) tashmë e njeh:
   `{ok:false, conflict:'number', number, nextNumber}` → rinumeron automatikisht, pa
   humbur punën e përdoruesit.
7. **Headerë sigurie + CORS (P2).**
   ```js
   const { securityHeaders, corsMultiOrigin, jsonLimit, rateLimit } = require('./middleware/security');
   app.disable('x-powered-by');
   app.use(securityHeaders);
   app.use(corsMultiOrigin);
   app.use(jsonLimit());
   app.use('/api', rateLimit({ max: Number(process.env.RATE_LIMIT_MAX || 500),
                               windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000) }));
   ```
   Vendose **para** `app.use(express.json())` të vjetër (përndryshe dy parser-a).
   `CORS_ORIGINS` duhet të përmbajë domenin e frontend-it — jo `*`.
8. **`GET /api/manual` (P3).**
   ```js
   require('./routes/manual').register(app, { middleware: [auth, requireCompanyMembership()] });
   ```
   Nëse dëshiron që manuali të jetë publik (pa login), kalo `{ middleware: [] }`.
   Përgjigja: `{ok:true, version:3, lang:'sq', modules:[…], moduleIds:[…], updatedAt}`.
9. **`GET /api/export/xlsx` (P3) — eksport në server, jo në browser.**
   ```js
   const { buildWorkbook, XLSX_MIME } = require('./lib/xlsx');

   const MODULE_COLUMNS = {
     customerReturns: { title: 'Kthimet e klientëve', sheetName: 'Kthimet', sql:
       `SELECT r.number, r.returned_at AS date, c.name AS customer, r.kg, r.total
          FROM customer_returns r LEFT JOIN customers c ON c.company_id = r.company_id AND c.id = r.customer_id
         ORDER BY r.returned_at DESC, r.number`,
       columns: [
         { key:'number', title:'Numri', width:16 },
         { key:'date', title:'Data', type:'date', width:12 },
         { key:'customer', title:'Klienti', width:28 },
         { key:'kg', title:'Kg', type:'kg', width:10 },
         { key:'total', title:'Shuma (ALL)', type:'money', width:14 } ] },
     // … shto modulet e tjera (weighings, sales, purchases, lots) me të njëjtën formë
   };

   app.get('/api/export/xlsx', auth, requireCompanyMembership(), async (req, res) => {
     const mod = MODULE_COLUMNS[String(req.query.module || '')];
     if (!mod) return res.status(404).json({ ok:false, error:'Modul i panjohur për eksport' });
     const rows = await withCompany(req.companyCtx, (c) => c.query(mod.sql).then(r => r.rows));
     const buf = buildWorkbook({
       title: mod.title + ' — ' + req.companyId,
       sheetName: mod.sheetName, columns: mod.columns, rows,
       pageSize: Number(process.env.XLSX_PAGE_SIZE || 20),   // slice(20)
       totalRow: { kg: sum(rows,'kg'), total: sum(rows,'total') }, totalLabel: 'SHUMA',
     });
     const fname = (req.query.module + '-' + new Date().toISOString().slice(0,10) + '.xlsx');
     res.setHeader('Content-Type', XLSX_MIME);
     res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
     res.setHeader('Cache-Control', 'no-store');
     res.end(buf);
   });
   const sum = (rs, k) => rs.reduce((a, r) => a + (Number(r[k]) || 0), 0);
   ```
   Emrat e tabelave/kolonave të moduleve të kthimeve duhen përshtatur me skemën tënde
   (në degën arena mund të jenë pjesë e `weighings` me `direction='return'`).
10. **Backup automatik me dryer (P3).**
    ```js
    const { runExclusive } = require('./lib/advisoryLock');
    const cron = require('node:cron'); // ose setInterval i thjeshtë nëse nuk ke varësi

    async function autoBackup() {
      for (const companyId of await activeCompanies()) {
        await withCompany({ companyId, userId: 'system', isSuperadmin: true }, async (client) => {
          await runExclusive(client, (process.env.AUTO_BACKUP_LOCK_KEY || 'biobes:auto-backup') + ':' + companyId, async () => {
            const dump = await buildCompanyDump(client, companyId);   // JSON i plotë për kompani
            await writeBackupFile(companyId, dump);                   // AUTO_BACKUP_DIR, mbaj AUTO_BACKUP_KEEP
          }, 'Backup-i është duke u kryer — provo pas pak');
        });
      }
    }
    ```
    Pa `node:cron`: `setInterval(() => { if (new Date().getUTCHours() === 3) autoBackup(); }, 15*60*1000)`.
    **Kurrë** wipe global: fshirja bëhet vetëm për kompani (`company_wipe_epoch`),
    siç e pret frontend-i.

---

## 5) Kujdeset e rëndësishme (të mësuarat nga ky sesion)

1. **`APP_DB_ROLE=biobes_app` është i detyrueshëm — pika më e rëndësishme e gjithë kit-it.**
   PostgreSQL **nuk** e zbaton RLS për SUPERUSER-in, **madje as me `FORCE ROW LEVEL
   SECURITY`**. PGlite lidhet si `postgres`, Aiven si `avnadmin`, Neon si
   `neon_superuser` — në këto raste politikat e 009 nuk kanë **asnjë** efekt dhe C1/C2
   nuk izolohen. Zgjidhja: `migrations/013_app_role.sql` krijon rolin `biobes_app`
   (NOSUPERUSER, jo pronar tabelash) me privilegjet e nevojshme, dhe `lib/pgCompany.js`
   bën `SET LOCAL ROLE biobes_app` në **çdo** transaksion (roli rikthehet në atë të
   seancës pas COMMIT/ROLLBACK, pra lidhja kthehet e pastër në pool). Ky sesion i
   provoi të dyja gjendjet: pa rolin → 6 prova izolimi dështuan; me rolin → 15/15 kaluan.
2. **`FORCE ROW LEVEL SECURITY` është i detyrueshëm.** Pa të, edhe pronari i tabelës
   (jo-superuser) e anashkalon RLS-në. Migrimi 009 e vendos për çdo tabelë.
3. **Login/migrime/backup → `withSystem(...)`.** Me FORCE RLS, një kërkesë pa kontekst
   nuk kthen asnjë rresht — edhe `SELECT` i përdoruesit gjatë login-it do dështonte.
4. **`set_config(..., true)` = SET LOCAL.** Kurrë `SET app.company_id = 'C1'` pa LOCAL
   në një pool: lidhja kthehet në pool me kontekstin e vjetër dhe i shërben kompanisë
   tjetër → rrjedhje. `lib/pgCompany.js` e bën gjithmonë brenda `BEGIN/COMMIT`.
5. **RLS + upsert:** `INSERT … ON CONFLICT DO NOTHING` mbi një rresht që ekziston por
   është i padukshëm për shkak të RLS **hedh unique violation** (nuk bën "nothing").
   `lib/sequences.js` e shmang duke qenë gjithmonë brenda kontekstit të saktë.
6. **Politikat varen nga GUC-të, jo nga `req`.** Nëse një rrugë harron
   `withCompany`, RLS kthen **0 rreshta** (jo të dhëna të huaja) — dështim i sigurt.
7. **`pool` max 10 me 20 përdorues:** mjafton **vetëm** nëse transaksionet janë të
   shkurtra. Mos i rrit pa matur — Aiven free ka ~20 lidhje gjithsej.
8. **PGlite ka një sesion:** prova vendore vërtetojnë logjikën, jo paralelizmin e vërtetë.
   Provat e konkurrencës (shih §6) bëhen kundër Postgres-it të zhvillimit.
9. **Mos prek formatet/UI.** Ky kit nuk ndryshon asnjë format shqip (A4 18 kolona,
   kolonat "të pashkruar = —", SHUMA poshtë djathtas, `print-footer` 9 mm) dhe asnjë
   model të dhënash të ekzistues.

---

## 6) Provat

### 6.1 Provat vendore të kit-it (PGlite — të sigurta)
```bash
cd backend
node test-kit-local.cjs
```
Kalon nëse: RLS izolon C1/C2 (lexim, shkrim, fshirje, kontekst i gabuar), superadmin
sheh gjithçka, konteksti nuk rrjedh midis transaksioneve, 30 kërkesa → 30 numra unikë
`FSH-<vit>-0001…0030`, numërim i ndarë për kompani, numër i zënë → `conflict` +
`nextNumber`, XLSX 45 rreshta → 3 faqe, JWT/scrypt.

### 6.2 Prova e konkurrencës së vërtetë (Postgres zhvillimi, JO prodhim)
Skripti i gatshëm: `backend/test-concurrency-local.cjs` — ekzekuton `lib/pgCompany.js`
dhe `lib/sequences.js` mbi një **`pg.Pool` të vërtetë** me 20 lidhje (pra `BEGIN` /
`SET LOCAL ROLE` / `set_config(...,true)` / `SELECT … FOR UPDATE` si në prodhim).

```bash
cd backend
CONCURRENCY_DATABASE_URL=postgres://user:pass@localhost:5432/biobes_dev \
  node test-concurrency-local.cjs
# opsione: CONCURRENCY=20 (numri i kërkesave njëkohësisht)
```

Çfarë provon:
1. 20 kërkesa njëkohësisht → **20 numra unikë**, të pandërprerë (`0001…0020`), dhe sa kohë zgjat
2. C1 dhe C2 numërohen **veçmas** në të njëjtin çast
3. 20 shkrime konkurrente në C1 + 5 në C2 → asnjë rrjedhje midis kompanive
4. Pas `COMMIT`, lidhja që kthehet në pool **nuk ka kontekst** të mbetur (`SET LOCAL`)
5. `SET LOCAL ROLE` nuk e ndryshon rolin e seancës

**KURRË** kundër prodhimit — skripti shkruan dokumente dhe produkte.

Pa `CONCURRENCY_DATABASE_URL` skripti **anashkalohet me mesazh** (exit 0, jo dështim).
Gjetje e këtij sesioni: `@electric-sql/pglite-socket@0.2.11` me `@electric-sql/pglite@0.5.8`
e shkëput lidhjen `pg` ("Connection terminated unexpectedly"), prandaj modaliteti
PGlite-socket është opt-in (`TRY_PGLITE_SOCKET=1`) dhe nuk është rruga e provës.
Për garë të vërtetë përdor Postgres zhvillimi (Docker: `docker run -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16`).

### 6.3 Verifikim LIVE (vetëm lexim — KURRË `test:live`)
```bash
curl -s https://biobes-api.onrender.com/api/health          # pret ok:true, db:true
curl -s https://biobes-api.onrender.com/api/manual | head   # pret ok:true, modules:[…]
curl -sI "https://biobes-api.onrender.com/api/export/xlsx?module=customerReturns" # pret 401 (pa token) ose 200
```
Render-i ka **cold start** ~50 s pas mosveprimit: përgjigja e parë mund të jetë faqja
"Application loading" — riprovo.

---

## 7) Nëse dëshiron varësi standarde (opsionale)

| Modul i kit-it | Zëvendësimi | Ndryshimi i nevojshëm |
|---|---|---|
| `lib/token.js` (JWT) | `jsonwebtoken` | `jwt.sign(payload, secret, {expiresIn})` / `jwt.verify` — ruaj emrat e funksioneve që thirrësit të mos ndryshojnë |
| `lib/token.js` (hash) | `bcrypt` | `bcrypt.hash(pw, 12)` / `bcrypt.compare` — `verifyPassword` tashmë kthen `false` për formate `bcrypt$…`, pra kalimi është i sigurt |
| `middleware/security.js` | `helmet` | `app.use(helmet({contentSecurityPolicy:{…}}))` — ruaj `corsMultiOrigin` (helmet nuk bën CORS) |
| `lib/xlsx.js` | `exceljs` ose `xlsx` | Zëvendëso `buildWorkbook`; ruaj **slice(20)** dhe **numFmt** (164 para, 165 kg, 14 datë) që formatet shqip të mos prishen |

Kit-i funksionon **pa** këto — zgjedhja është e lirë.

---

## 8) Lidhja me frontend-in (`biobes-erp`, PR #82)

Frontend-i tashmë është gati dhe **pret** këto sjellje nga API-ja:

| Kontrata | Si e plotëson kit-i |
|---|---|
| `X-Company-Id` në çdo kërkesë + `?company=` në SSE | `companyFromRequest()` / `requireCompanyMembership()` |
| `{ok:false, conflict:'number', number, nextNumber}` → 409 | `sequences.reserveNumber()` |
| Snapshot pas-riaktivizimi + wipe i plotë → rikthim nga serveri | `company_sync.version` + `company_wipe_epoch` (nga 007) |
| Asgjë biznesi në `localStorage` (vetëm meta/cilësime) | `/api/manual` + `/api/export/xlsx` në server |
| Presync snapshot në IndexedDB `cloud:presync:<co>` | nuk kërkon ndryshim në backend |
| Wipe **për kompani**, kurrë global | `withCompany` + `company_wipe_epoch`; backup me `advisoryLock` |

Provat e frontend-it që vërtetojnë këto kontrata (të gjitha jeshile në PR #82):
`tests/cloud-isolation-audit.cjs` (22/0), `multi-company-audit` (20/20),
`cloud-realtime-audit` (56/0), `blind-write-audit` (15/0), `doc-number-sync-audit` (10/0),
`recovery-audit` (4), `server-backups-audit` (8/0), `doc-numbering-audit` (15/0).

Dokumentet shoqëruese në `biobes-erp`:
- `PLAN-DEPLOY-BIOBES-API.md` — rindërtimi P1/P2/P3 + kontrata e pritur + Render + wipe C3
- `VERIFIKIM-LIVE-2026-09-22.md` — gjendja LIVE/GitHub e verifikuar
- `README-DEPLOY.md`, `tests/README.md`

---

## 9) Përkufizimi i «mbaruar» (acceptance)

- [ ] `node backend/test-kit-local.cjs` → **15/15** (0 dështime)
- [ ] `APP_DB_ROLE=biobes_app` i caktuar në `.env` **dhe** në Render → Environment
- [ ] `psql` (dev): `SELECT rolname, rolsuper FROM pg_roles WHERE rolname IN ('biobes_app', current_user);`
      → `biobes_app` ekziston me `rolsuper = false`
- [ ] Prova e konkurrencës (§6.2) me 20 kërkesa → 20 numra unikë
- [ ] `psql` (dev): `SELECT count(*) FROM pg_policies WHERE schemaname='public'` ≥ 15
- [ ] `psql` (dev), si rol jo-superuser: `SET ROLE biobes_app; SELECT set_config('app.company_id','C2',false); SELECT count(*) FROM products;`
      → vetëm rreshtat e C2 **dhe** vetëm nëse përdoruesi është anëtar i C2 (përndryshe 0)
- [ ] `/api/health` LIVE → `ok:true, db:true`
- [ ] `/api/manual` LIVE → `ok:true, modules:[…]` (jo më «Endpoint i panjohur»)
- [ ] `/api/export/xlsx?module=customerReturns` LIVE me token → skedar `.xlsx` që hapet në Excel
      me 20 rreshta për faqe dhe data/para/kg të formatuara
- [ ] Headerat: `curl -sI` tregon `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`
- [ ] CORS: kërkesa nga origjinë e palejuar → **pa** `Access-Control-Allow-Origin`
- [ ] Asnjë `npm run test:live` i ekzekutuar kundër prodhimit
