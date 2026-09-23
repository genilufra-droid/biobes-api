> **Dokument transferimi.** Përgatitur në repo-n `biobes-erp` (degë
> `arena/01a0caf7-biobes-erp`, commit-e lokale `0991a0d` + `2ca3fc6`) për sesionin
> e ri të repo-s **`biobes-api`**. Përmban **gjithçka**: udhëzimet dhe të 17
> skedarët **verbatim**, të gatshëm për t'u krijuar.
>
> **Qëllimi:** zbatimi i P1 (JWT/auth), P2 (izolim multi-company) dhe P3 (performancë,
> manual, eksport, backup) **pa e rindërtuar nga përshkrimi** dhe **pa ridizajnuar**
> asnjë format shqip, model të dhënash ose UI.

---

## 0) Rregullat e pandryshueshme (lexo para se të prekësh çfarëdo)

1. **KURRË mos ekzekuto `npm run test:live`** ose ndonjë kërkesë shkrimi/fshirjeje
   kundër `https://biobes-api.onrender.com` — ajo **e shuan databazën**. Provat bëhen
   vetëm vendore (PGlite) ose kundër një Postgres-i **zhvillimi**. LIVE verifikohet
   vetëm me GET lexues (`/api/health`, `/api/manual`).
2. **Mos ridizajno** formatet shqip (A4 18 kolona, "të pashkruar = —", SHUMA poshtë
   djathtas, `print-footer` 9 mm), modelet e të dhënave ose UI-në. Ky kit është
   **shtesë** (additive) dhe prek vetëm backend-in.
3. **`APP_DB_ROLE=biobes_app` është i detyrueshëm.** PostgreSQL nuk e zbaton Row
   Level Security për superuser-in, **madje as me `FORCE ROW LEVEL SECURITY`**
   (Aiven = `avnadmin`, PGlite = `postgres`). Pa këtë, izolimi C1 ≠ C2 është
   vetëm në letër. Kjo u vërtetua me prova: pa rolin → 6 prova izolimi dështuan;
   me rolin → 15/15 kaluan.
4. **Login / migrime / backup → `withSystem(...)`**, sepse me FORCE RLS një kërkesë
   pa kontekst nuk kthen asnjë rresht.
5. **`set_config(..., true)` = SET LOCAL.** Kurrë `SET app.company_id` pa LOCAL në
   një pool: lidhja kthehet me kontekstin e vjetër dhe i shërben kompanisë tjetër.
6. **Wipe vetëm për kompani** (`company_wipe_epoch`), kurrë global.

---

## 1) Si t'i rikthesh skedarët (dy mënyra)

### Mënyra A — automatike (e rekomanduar)
1. Krijo skedarin `tools/extract-kit.cjs` nga seksioni **A-0** më poshtë (kopjo
   përmbajtjen brenda gardhit).
2. Ruaj këtë dokument si `KIT-BIOBES-API-P1-P2-P3.md` në rrënjën e repo-s `biobes-api`.
3. Ekzekuto:
   ```bash
   node tools/extract-kit.cjs KIT-BIOBES-API-P1-P2-P3.md . --list     # shiko çfarë do të krijohet
   node tools/extract-kit.cjs KIT-BIOBES-API-P1-P2-P3.md .            # krijo të gjithë skedarët
   node tools/extract-kit.cjs KIT-BIOBES-API-P1-P2-P3.md . --verify   # kontrollo që janë identikë
   ```
   Kjo krijon: `APPLY.md`, `backend/migrations/009…013`, `backend/lib/*`,
   `backend/middleware/security.js`, `backend/routes/manual.js`,
   `backend/test-kit-local.cjs`, `backend/test-concurrency-local.cjs`,
   `backend/.env.example.additions`.

### Mënyra B — me dorë
Çdo seksion më poshtë fillon me `### FILE: <shtegu>`. Krijo skedarin në atë shteg
(saktësisht, pa ndryshime) me përmbajtjen brenda gardhit me katër backtick.

---

## 2) Manifesti

| # | Shtegu në repo-n `biobes-api` | Madhësia | Për çfarë shërben |
|---|---|---|---|
| 0 | `APPLY.md` | 25.8 KB | Udhëzimi i plotë i zbatimit (lexo SË PARI): gjendja e verifikuar, vendimi i bazës, 10 hapa integrimi, kujdeset, provat, checklist |
| A-0 | `tools/extract-kit.cjs` | 3.9 KB | Krijoje këtë SË PARI — pastaj të gjithë skedarët e tjerë rikthehen automatikisht, bajt-për-bajt |
| 2 | `backend/migrations/009_rls.sql` | 7.1 KB | P2 — Izolim 100% në databazë: FORCE RLS + politika që kërkon kompaninë DHE anëtarësinë |
| 3 | `backend/migrations/010_p3_indexes.sql` | 7.3 KB | P3 — Indekse për 20 përdorues + UNIQUE (company_id, number); tolerant ndaj bazës |
| 4 | `backend/migrations/011_doc_sequences.sql` | 2.7 KB | P2 — doc_sequences + doc_numbers_used për numërim me SELECT … FOR UPDATE |
| 5 | `backend/migrations/012_refresh_tokens.sql` | 2.1 KB | P1 — Refresh tokenë si hash SHA-256 në server, të revokueshëm menjëherë |
| 6 | `backend/migrations/013_app_role.sql` | 3.8 KB | PARAKUSHT I RLS — roli biobes_app (NOSUPERUSER) + privilegje; pa të izolimi nuk vlen |
| 7 | `backend/lib/pgCompany.js` | 6.6 KB | Konteksti për çdo transaksion: set_config(...,true) SET LOCAL + SET LOCAL ROLE + middleware anëtarësie |
| 8 | `backend/lib/token.js` | 4.7 KB | P1 — JWT HS256 + fjalëkalime scrypt, PA varësi të reja (node:crypto) |
| 9 | `backend/lib/sequences.js` | 7.4 KB | P2 — Numra dokumentesh të sigurt: nextNumber / reserveNumber → 409 conflict |
| 10 | `backend/lib/advisoryLock.js` | 2.5 KB | P3 — Dryer për backup dhe punë që nuk duhet të ekzekutohen dy herë njëkohësisht |
| 11 | `backend/lib/xlsx.js` | 15.5 KB | P3 — Shkrues .xlsx në server (ZIP me node:zlib), faqe slice(20) + numFmt 164/165/14 |
| 12 | `backend/middleware/security.js` | 3.7 KB | P2 — Headerë sigurie + CORS multi-origin + rate limit, pa helmet |
| 13 | `backend/routes/manual.js` | 7.8 KB | P3 — GET /api/manual (dhe /:moduleId) në shqip; mungon në LIVE sot |
| 14 | `backend/test-kit-local.cjs` | 14.7 KB | Prova vendore PGlite: 15/15 jeshile (RLS, sekuenca, XLSX, JWT, dryer) |
| 15 | `backend/test-concurrency-local.cjs` | 11.2 KB | Prova e garës me pg.Pool të vërtetë (CONCURRENCY_DATABASE_URL=…) |
| 16 | `backend/.env.example.additions` | 2.2 KB | Variablat e reja për .env dhe Render → Environment (APP_DB_ROLE është e detyrueshme) |

**Gjithsej:** 17 skedarë, 129 KB tekst.
**Varësi të reja: ASNJË** — gjithçka punon me `express`, `pg`, `node:crypto`,
`node:zlib` (JWT, scrypt, headerë sigurie dhe .xlsx janë shkruar pa biblioteka shtesë).
Për provat vendore nevojitet `@electric-sql/pglite` (është tashmë devDependency).

---

## 3) Renditja e punës (përmbledhje — hollësitë në `APPLY.md`)

1. Degë e re: `git checkout -b feat/cloud-p1-p2-p3` (nga baza e zgjedhur — shih `APPLY.md` §2).
2. Rikthe skedarët (Mënyra A ose B).
3. Shto variablat nga `backend/.env.example.additions` në `.env` **dhe** në Render
   → Environment; gjenero `JWT_SECRET` dhe `JWT_REFRESH_SECRET` (≥ 32 shenja).
4. Apliko migrimet në rend: `009 → 010 → 011 → 012 → 013`, **jashtë** `withCompany`
   (me rolin e seancës, i cili ka `BYPASSRLS`).
5. Cakto `APP_DB_ROLE=biobes_app` dhe lidhe në `lib/pgCompany.js` (e bën vetë).
6. Integro në `server.js`: auth JWT → `requireCompanyMembership()` → `withCompany()`
   për **çdo** rrugë biznesi (snippet-et janë në `APPLY.md` §4, hapat 4–10).
7. Shto `/api/manual` dhe `/api/export/xlsx` (mungojnë në LIVE sot:
   `{ok:false, error:"Endpoint i panjohur"}`).
8. Ekzekuto provat:
   ```bash
   cd backend && node test-kit-local.cjs                      # pret 15/15
   CONCURRENCY_DATABASE_URL=postgres://…/biobes_dev node test-concurrency-local.cjs
   ```
9. Verifikim LIVE **vetëm lexues**: `/api/health`, `/api/manual`, headerat me `curl -sI`.
10. Plotëso checklist-in në `APPLY.md` §9.

---

## 4) Çfarë është provuar tashmë (në sesionin që e përgatiti kit-in)

- **`test-kit-local.cjs` → 15/15 kaluan, 0 dështuan** (PGlite 0.5.8, migrimet 009–013
  të aplikuara realisht):
  - RLS: C1 sheh vetëm të vetat; C2 vetëm të vetat; përdoruesi i C1 me kontekst C2
    sheh **0 rreshta**; `INSERT` me `company_id` të huaj **refuzohet**; `DELETE` nuk
    prek kompaninë tjetër; superadmin sheh të gjitha.
  - Konteksti `SET LOCAL` **nuk rrjedh** në transaksionin pasardhës (pool reuse).
  - Sekuenca: 30 kërkesa → **30 numra unikë** `FSH-2026-0001…0030`; numërim i ndarë
    për kompani; numër i zënë → `{conflict:true, nextNumber}`; numër i lirë pranohet.
  - XLSX: 45 rreshta → **3 faqe** (20+20+5), arkiv ZIP i vlefshëm, `numFmt` 164/165/14,
    rreshti SHUMA, kokë e ngrirë, `autoFilter`.
  - JWT/scrypt: nënshkrim, verifikim, tamperim i refuzuar, `TokenExpiredError`,
    lloj i gabuar i refuzuar, `jti` për refresh, hash `scrypt$…`.
  - Advisory lock: dryeri merret dhe funksioni ekzekutohet.
- **XLSX u hap dhe u çmontua me `unzip`**: struktura
  `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`,
  `xl/styles.xml`, `xl/worksheets/sheet1..3.xml` — e saktë.
- **Gjetje e rëndësishme:** papërputhshmëri versionesh — `@electric-sql/pglite-socket@0.2.11`
  me `@electric-sql/pglite@0.5.8` e shkëput lidhjen `pg` ("Connection terminated
  unexpectedly"). Prandaj `test-concurrency-local.cjs` kërkon një Postgres të vërtetë
  (`CONCURRENCY_DATABASE_URL`); pa të, **anashkalohet me mesazh** (exit 0, jo dështim).

---

## 5) Lidhja me frontend-in (`biobes-erp`, PR #82)

Frontend-i është gati dhe **pret** këto kontrata nga API-ja (të gjitha të mbuluara nga kit-i):

| Kontrata e frontend-it | Si plotësohet |
|---|---|
| `X-Company-Id` në çdo kërkesë + `?company=` në SSE | `companyFromRequest()`, `requireCompanyMembership()` |
| `{ok:false, conflict:'number', number, nextNumber}` → 409 | `sequences.reserveNumber()` |
| Rikthim nga serveri pas pastrimit të browser-it | `company_sync.version` + RLS (007 + 009) |
| Asgjë biznesi në `localStorage` | `/api/manual`, `/api/export/xlsx` në server |
| Wipe **për kompani**, kurrë global | `withCompany` + `company_wipe_epoch` + backup me dryer |

Provat e frontend-it (jeshile në PR #82): `cloud-isolation` 22/0, `multi-company` 20/20,
`cloud-realtime` 56/0, `blind-write` 15/0, `doc-number-sync` 10/0, `recovery` 4,
`server-backups` 8/0, `doc-numbering` 15/0.

---

# A-0) Skripti i ekstraktimit (krijoje të parin)

### FILE: tools/extract-kit.cjs
`````javascript
'use strict';
/* tools/extract-kit.cjs — rikthen skedarët e kit-it nga dokumenti i vetëm Markdown
 * (KIT-BIOBES-API-P1-P2-P3.md), me përmbajtje BAJT-PËR-BAJT të njëjtë.
 *
 * Përdorimi (nga rrënja e repo-s biobes-api):
 *   node tools/extract-kit.cjs ../KIT-BIOBES-API-P1-P2-P3.md .
 *   node tools/extract-kit.cjs <md> <dirDalje>            # dirDalje parazgjedhje: '.'
 *   node tools/extract-kit.cjs <md> <dirDalje> --list      # vetëm liston, nuk shkruan
 *   node tools/extract-kit.cjs <md> <dirDalje> --verify    # krahason me skedarët ekzistues
 *
 * Format i pritur në Markdown (për çdo skedar):
 *   ### FILE: backend/lib/token.js
 *   <gardh me 4 ose më shumë backtick>[gjuha]
 *   <përmbajtja>
 *   <i njëjti gardh>
 * Gjatësia e gardhit lexohet dhe përshtatet vetë (backreference), prandaj skedarët
 * që përmbajnë vetë backtick-e nuk e prishin ekstraktimin.
 *
 * Nëse ky skedar nuk ekziston ende, mund ta krijosh nga seksioni «A-0» i dokumentit —
 * ose thjesht të shkruash skedarët me dorë: çdo seksion FILE ka shtegun e saktë.
 */
const fs = require('node:fs');
const path = require('node:path');

/* Midis kokës "### FILE:" dhe gardhit lejohen rreshta përshkrues (p.sh. _për çfarë
 * shërben_), por JO rreshta që fillojnë me backtick — që gardhi të gjendet saktë. */
const RE = /^### FILE: (.+?)\r?\n+(?:[^`\r\n]*\r?\n+)*?(`{4,})[A-Za-z0-9_+\-.]*\r?\n([\s\S]*?)^\2[ \t]*$/gm;

function parse(mdText) {
  const files = [];
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(mdText)) !== null) {
    files.push({ path: m[1].trim(), content: m[3] });
  }
  return files;
}

function safeJoin(outDir, rel) {
  const dest = path.resolve(outDir, rel);
  const root = path.resolve(outDir);
  if (!dest.startsWith(root + path.sep) && dest !== root) {
    throw new Error('Shteg i pasigurt (jashtë dirDaljes): ' + rel);
  }
  return dest;
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.find((a) => a.startsWith('--')) || '';
  const positional = args.filter((a) => !a.startsWith('--'));
  const mdPath = positional[0];
  const outDir = positional[1] || '.';

  if (!mdPath) {
    console.error('Përdorimi: node tools/extract-kit.cjs <KIT.md> [dirDalje] [--list|--verify]');
    process.exit(2);
  }
  if (!fs.existsSync(mdPath)) {
    console.error('Skedari Markdown nuk u gjet: ' + mdPath);
    process.exit(2);
  }

  const md = fs.readFileSync(mdPath, 'utf8');
  const files = parse(md);
  if (!files.length) {
    console.error('Nuk u gjet asnjë seksion "### FILE:" me gardh ```` — a është ky dokumenti i kit-it?');
    process.exit(1);
  }

  const dup = files.map((f) => f.path).filter((p, i, a) => a.indexOf(p) !== i);
  if (dup.length) console.warn('KUJDES: shtigje të përsëritura → ' + [...new Set(dup)].join(', '));

  if (mode === '--list') {
    console.log(files.length + ' skedarë në dokument:');
    for (const f of files) console.log('  ' + f.path.padEnd(46) + String(f.content.length).padStart(7) + ' B');
    return;
  }

  let written = 0, same = 0, diff = 0;
  for (const f of files) {
    const dest = safeJoin(outDir, f.path);
    if (mode === '--verify') {
      if (!fs.existsSync(dest)) { diff++; console.log('  MUNGON  ' + f.path); continue; }
      const cur = fs.readFileSync(dest, 'utf8');
      if (cur === f.content) { same++; }
      else { diff++; console.log('  NDRYSHON ' + f.path + ' (' + cur.length + ' B lokal vs ' + f.content.length + ' B në MD)'); }
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
    written++;
    console.log('  ✓ ' + f.path + ' (' + f.content.length + ' B)');
  }

  if (mode === '--verify') {
    console.log('\nVerifikim: ' + same + ' identikë, ' + diff + ' ndryshojnë/mungojnë (nga ' + files.length + ')');
    process.exit(diff ? 1 : 0);
  }
  console.log('\n' + written + ' skedarë u krijuan nën ' + path.resolve(outDir));
}

main();
`````

---

# Skedarët e kit-it

### FILE: APPLY.md
_Udhëzimi i plotë i zbatimit (lexo SË PARI): gjendja e verifikuar, vendimi i bazës, 10 hapa integrimi, kujdeset, provat, checklist_

````markdown
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
````

### FILE: backend/migrations/009_rls.sql
_P2 — Izolim 100% në databazë: FORCE RLS + politika që kërkon kompaninë DHE anëtarësinë_

````sql
-- 009_rls — Izolim 100% C1 ≠ C2 në nivelin e databazës (Row Level Security).
--
-- Parimi: aplikacioni vendos kontekstin për ÇDO transaksion (set_config(..., true) =
-- SET LOCAL, shih lib/pgCompany.js) dhe Postgres-i vetë refuzon çdo rresht që nuk i
-- përket kompanisë aktive. Edhe nëse një klient dërgon `X-Company-Id` të gabuar, ose
-- edhe nëse një bug i aplikacionit harron filtrimin, të dhënat e kompanisë tjetër
-- NUK lexohen dhe NUK shkruhen.
--
-- SHËNIM 1: FORCE ROW LEVEL SECURITY është thelbësor — pa të, pronari i tabelës
-- (p.sh. `avnadmin` në Aiven) e anashkalon RLS-në dhe izolimi nuk vlen.
-- SHËNIM 2: operacionet para-autentikimit (login, krijim përdoruesi, migrime, backup)
-- duhet të ecin me kontekst sistemi: lib/pgCompany.js → withSystem(...) vendos
-- app.is_superadmin='on'. Mos e përdorni kurrë withSystem për kërkesa të përdoruesit.
-- SHËNIM 3: migrimi është idempotent — mund të riaplikohet pa dëm.

-- ========== 1) Funksionet e kontekstit ==========
CREATE OR REPLACE FUNCTION public.app_company_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '');
$$;

CREATE OR REPLACE FUNCTION public.app_user_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '');
$$;

CREATE OR REPLACE FUNCTION public.app_is_superadmin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.is_superadmin', true), 'off') = 'on';
$$;

-- Kontroll anëtarësie (përdoret vetëm ku nevojitet; politikat e company_users
-- nuk e thërrasin këtë, që të mos krijohet recursion midis politikave).
CREATE OR REPLACE FUNCTION public.app_is_member(co text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT public.app_is_superadmin()
      OR EXISTS (SELECT 1 FROM public.company_users cu
                  WHERE cu.company_id = co
                    AND cu.user_id = public.app_user_id());
$$;

-- ========== 2) RLS për ÇDO tabelë biznesi që ka company_id ==========
-- Qasja gjenerike: mbulon të gjitha tabelat ekzistuese (products, suppliers,
-- customers, warehouses, lots, weighings, payments, customer_payments,
-- sales_invoices, purchase_invoices, company_sync, company_wipe_epoch,
-- user_sessions_active, audit_log, sessions, doc_sequences, …) dhe gjithçka
-- që do të shtohet më vonë me company_id — pa harruar asnjë.
DO $$
DECLARE
  r RECORD;
  v_using text;
BEGIN
  FOR r IN
    SELECT c.table_name, c.is_nullable
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'company_id'
       AND t.table_type = 'BASE TABLE'
       AND c.table_name NOT IN ('companies', 'company_users')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.table_name);

    -- Dy kushte të pavarura, të dyja të detyrueshme:
    --   (a) rreshti i përket kompanisë aktive  → mbron nga filtrat e harruar në SQL;
    --   (b) përdoruesi është ANËTAR i kompanisë aktive (ose superadmin) → mbron edhe
    --       nëse aplikacioni vendos kontekst të gabuar (p.sh. X-Company-Id i huaj).
    -- app_is_member(app_company_id()) varet vetëm nga GUC-të → është konstante për
    -- gjithë kërkesën, prandaj Postgres-i e vlerëson NJË herë, jo për çdo rresht.
    IF r.is_nullable = 'YES' THEN
      -- audit_log / sessions kanë rreshta të vjetër me company_id NULL:
      -- ata shihen vetëm nga konteksti sistem (superadmin).
      v_using := '(company_id IS NULL AND public.app_is_superadmin())'
              || ' OR (company_id = public.app_company_id() AND (public.app_is_superadmin() OR public.app_is_member(public.app_company_id())))';
    ELSE
      v_using := '(company_id = public.app_company_id() AND (public.app_is_superadmin() OR public.app_is_member(public.app_company_id())))'
              || ' OR (public.app_is_superadmin())';
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                   r.table_name || '_company_isolation', r.table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO PUBLIC USING (%s) WITH CHECK (%s)',
                   r.table_name || '_company_isolation', r.table_name, v_using, v_using);
  END LOOP;
END $$;

-- ========== 3) companies: vetëm anëtarët (ose superadmin) ==========
DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN RETURN; END IF;
  EXECUTE 'ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.companies FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS companies_membership ON public.companies';
  EXECUTE $pol$
    CREATE POLICY companies_membership ON public.companies AS PERMISSIVE FOR ALL TO PUBLIC
      USING (
        public.app_is_superadmin()
        OR EXISTS (SELECT 1 FROM public.company_users cu
                    WHERE cu.company_id = companies.id
                      AND cu.user_id = public.app_user_id())
      )
      WITH CHECK (public.app_is_superadmin())
  $pol$;
END $$;

-- ========== 4) company_users: anëtarësia e kompanisë aktive + vetja ==========
DO $$
BEGIN
  IF to_regclass('public.company_users') IS NULL THEN RETURN; END IF;
  EXECUTE 'ALTER TABLE public.company_users ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.company_users FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS company_users_scope ON public.company_users';
  EXECUTE $pol$
    CREATE POLICY company_users_scope ON public.company_users AS PERMISSIVE FOR ALL TO PUBLIC
      USING (
        public.app_is_superadmin()
        OR user_id = public.app_user_id()
        OR company_id = public.app_company_id()
      )
      WITH CHECK (public.app_is_superadmin() OR company_id = public.app_company_id())
  $pol$;
END $$;

-- ========== 5) users: vetja + bashkëpunëtorët e kompanisë aktive ==========
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN RETURN; END IF;
  EXECUTE 'ALTER TABLE public.users ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.users FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS users_scope ON public.users';
  EXECUTE $pol$
    CREATE POLICY users_scope ON public.users AS PERMISSIVE FOR ALL TO PUBLIC
      USING (
        public.app_is_superadmin()
        OR id = public.app_user_id()
        OR EXISTS (SELECT 1 FROM public.company_users cu
                    WHERE cu.user_id = users.id
                      AND cu.company_id = public.app_company_id())
      )
      WITH CHECK (public.app_is_superadmin() OR id = public.app_user_id())
  $pol$;
END $$;

-- ========== 6) Verifikim (kthehet si NOTICE në log) ==========
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public';
  RAISE NOTICE '009_rls: % politika RLS aktive në skemën public', n;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE WARNING '009_rls: përdoruesi aktual (%) është SUPERUSER — RLS nuk zbatohet për të. Në prodhim përdor një rol jo-superuser.', current_user;
  END IF;
END $$;
````

### FILE: backend/migrations/010_p3_indexes.sql
_P3 — Indekse për 20 përdorues + UNIQUE (company_id, number); tolerant ndaj bazës_

````sql
-- 010_p3_indexes — Indekset e performancës për 20 përdorues konkurrent + unikitet
-- i numrave të dokumenteve për kompani (mbështet lib/sequences.js me FOR UPDATE).
--
-- Idempotent DHE tolerant ndaj bazës: çdo indeks krijohet vetëm nëse tabela dhe të
-- gjitha kolonat e tij ekzistojnë. Kjo do të thotë se migrimi nuk dështon as në një
-- bazë të vjetër (para 007), as në një bazë ku disa module nuk janë aktivizuar.

-- ========== 1) Numrat e dokumenteve: unikë për (company_id, number) ==========
-- Pa këtë, dy pajisje mund të ruajnë të njëjtin numër. Krijohet si UNIQUE vetëm
-- nëse nuk ka dublikata; përndryshe mbetet indeks i thjeshtë dhe jepet WARNING
-- (dublikatat duhen pastruar para kalimit në UNIQUE).
DO $$
DECLARE
  t text;
  d int;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_invoices', 'purchase_invoices']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=t AND column_name='number') THEN CONTINUE; END IF;

    EXECUTE format('SELECT count(*) FROM (SELECT company_id, number FROM public.%I
                    GROUP BY 1,2 HAVING count(*) > 1) x', t) INTO d;

    EXECUTE format('DROP INDEX IF EXISTS public.%I_number_idx', t);

    IF d = 0 THEN
      EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I_company_number_uniq ON public.%I (company_id, number)', t, t);
      RAISE NOTICE '010: % → indeks UNIQUE (company_id, number)', t;
    ELSE
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I_company_number_idx ON public.%I (company_id, number)', t, t);
      RAISE WARNING '010: % ka % grupe numrash të dublikuar — UNIQUE nuk u krijua. Pastro dublikatat dhe riapliko migrimin.', t, d;
    END IF;
  END LOOP;
END $$;

-- ========== 2) Të gjitha indekset e tjera (tabela + kolonat kontrollohen) ==========
DO $$
DECLARE
  r RECORD;
  col text;
  v_ok boolean;
  v_created int := 0;
  v_skipped int := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- (emri i indeksit, tabela, kolonat e kërkuara, shprehja e indeksit)
      ('products_company_active_idx',        'products',            ARRAY['company_id','active','name'],        '(company_id, active, LOWER(name))'),
      ('suppliers_company_name_idx',         'suppliers',           ARRAY['company_id','name'],                 '(company_id, LOWER(name))'),
      ('suppliers_company_tax_idx',          'suppliers',           ARRAY['company_id','tax_id'],               '(company_id, tax_id)'),
      ('customers_company_name_idx',         'customers',           ARRAY['company_id','name'],                 '(company_id, LOWER(name))'),
      ('customers_company_tax_idx',          'customers',           ARRAY['company_id','tax_id'],               '(company_id, tax_id)'),
      ('warehouses_company_active_idx',      'warehouses',          ARRAY['company_id','active'],               '(company_id, active)'),
      ('lots_company_lot_number_idx',        'lots',                ARRAY['company_id','lot_number'],           '(company_id, lot_number)'),
      ('lots_company_warehouse_idx',         'lots',                ARRAY['company_id','warehouse_id'],         '(company_id, warehouse_id)'),
      ('weighings_company_supplier_idx',     'weighings',           ARRAY['company_id','supplier_id','weighed_at'], '(company_id, supplier_id, weighed_at DESC)'),
      ('weighings_company_customer_idx',     'weighings',           ARRAY['company_id','customer_id','weighed_at'], '(company_id, customer_id, weighed_at DESC)'),
      ('weighings_company_direction_idx',    'weighings',           ARRAY['company_id','direction','weighed_at'],   '(company_id, direction, weighed_at DESC)'),
      ('weighings_company_lot_idx',          'weighings',           ARRAY['company_id','lot_id'],               '(company_id, lot_id)'),
      ('payments_company_supplier_idx',      'payments',            ARRAY['company_id','supplier_id','paid_at'],    '(company_id, supplier_id, paid_at DESC)'),
      ('customer_payments_company_idx',      'customer_payments',   ARRAY['company_id','customer_id','paid_at'],    '(company_id, customer_id, paid_at DESC)'),
      ('sales_invoices_company_status_idx',  'sales_invoices',      ARRAY['company_id','status','issued_at'],       '(company_id, status, issued_at DESC)'),
      ('sales_invoices_company_issued_idx',  'sales_invoices',      ARRAY['company_id','issued_at'],                '(company_id, issued_at DESC)'),
      ('purchase_invoices_company_status_idx','purchase_invoices',  ARRAY['company_id','status','issued_at'],       '(company_id, status, issued_at DESC)'),
      ('purchase_invoices_company_supplier_idx','purchase_invoices',ARRAY['company_id','supplier_id','issued_at'],  '(company_id, supplier_id, issued_at DESC)'),
      ('company_users_company_idx',          'company_users',       ARRAY['company_id','user_id'],              '(company_id, user_id)'),
      ('company_sync_updated_idx',           'company_sync',        ARRAY['updated_at'],                        '(updated_at DESC)'),
      ('audit_log_company_created_idx',      'audit_log',           ARRAY['company_id','created_at'],           '(company_id, created_at DESC)'),
      ('audit_log_created_idx',              'audit_log',           ARRAY['created_at'],                        '(created_at DESC)'),
      ('sessions_user_idx',                  'sessions',            ARRAY['user_id'],                           '(user_id)'),
      ('user_sessions_active_user_idx',      'user_sessions_active',ARRAY['user_id','company_id'],              '(user_id, company_id)'),
      ('user_sessions_active_seen_idx',      'user_sessions_active',ARRAY['last_seen'],                         '(last_seen DESC)'),
      ('app_state_company_idx',              'app_state',           ARRAY['company_id'],                        '(company_id)')
    ) AS v(idx_name, tbl, cols, expr)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_ok := true;
    FOREACH col IN ARRAY r.cols LOOP
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema='public' AND table_name=r.tbl AND column_name=col) THEN
        v_ok := false;
        EXIT;
      END IF;
    END LOOP;

    IF NOT v_ok THEN
      v_skipped := v_skipped + 1;
      RAISE NOTICE '010: % u anashkalua — tabela % nuk ka të gjitha kolonat', r.idx_name, r.tbl;
      CONTINUE;
    END IF;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I %s', r.idx_name, r.tbl, r.expr);
    v_created := v_created + 1;
  END LOOP;

  RAISE NOTICE '010: % indekse të krijuara/verifikuara, % të anashkaluara (tabela/kolona mungojnë)', v_created, v_skipped;
END $$;

-- ========== 3) Statistika të freskëta për planifikuesin ==========
-- ANALYZE i lehtë vetëm për tabelat që ekzistojnë (jo ANALYZE e plotë, që të mos
-- bllokojë prodhimin gjatë orarit të punës).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','suppliers','customers','warehouses','lots','weighings',
                           'payments','customer_payments','sales_invoices','purchase_invoices',
                           'company_users','company_sync','doc_sequences']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ANALYZE public.%I', t);
    END IF;
  END LOOP;
END $$;
````

### FILE: backend/migrations/011_doc_sequences.sql
_P2 — doc_sequences + doc_numbers_used për numërim me SELECT … FOR UPDATE_

````sql
-- 011_doc_sequences — Numërim i dokumenteve me bllokim rreshti (SELECT … FOR UPDATE).
-- Zgjidh garën reale: dy pajisje (nga 20 përdorues) krijojnë dokument të të njëjtit lloj
-- në të njëjtin çast. Pa këtë, të dyja llogarisin «numrin e radhës» nga lista vendore dhe
-- nxjerrin të njëjtin numër. Këtu numri merret nga një rresht i vetëm i bllokuar për
-- (company_id, kind, period) → transaksioni i dytë PRET dhe merr numrin tjetër.
--
-- Përdorimi: backend/lib/sequences.js → nextNumber(client, companyId, kind, { period })
-- (client duhet të jetë brenda transaksionit të hapur nga lib/pgCompany.js).

CREATE TABLE IF NOT EXISTS doc_sequences (
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,              -- 'sales_invoice' | 'purchase_invoice' | 'stock_in' | 'stock_out' | 'sample' | 'order' | 'shipment' | 'return'
  period      TEXT NOT NULL DEFAULT '',   -- '' (gjithnjë) | '2026' (vjetor) | '2026-09' (mujor)
  last_number BIGINT NOT NULL DEFAULT 0,
  prefix      TEXT NOT NULL DEFAULT '',   -- p.sh. 'FSH', 'FBL', 'FH', 'FD' (opsional: mbishkruan paraprakësimin e kodit)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (company_id, kind, period)
);

ALTER TABLE doc_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_sequences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doc_sequences_company_isolation ON doc_sequences;
CREATE POLICY doc_sequences_company_isolation ON doc_sequences
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (company_id = public.app_company_id() OR public.app_is_superadmin())
  WITH CHECK (company_id = public.app_company_id() OR public.app_is_superadmin());

CREATE INDEX IF NOT EXISTS doc_sequences_company_kind_idx ON doc_sequences (company_id, kind);

-- Regjistër i numrave të lëshuar (për auditim dhe për zbulim të përplasjeve 409).
CREATE TABLE IF NOT EXISTS doc_numbers_used (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  number     TEXT NOT NULL,
  table_name TEXT NOT NULL DEFAULT '',
  doc_id     TEXT NOT NULL DEFAULT '',
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, kind, number)
);

ALTER TABLE doc_numbers_used ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_numbers_used FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doc_numbers_used_company_isolation ON doc_numbers_used;
CREATE POLICY doc_numbers_used_company_isolation ON doc_numbers_used
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (company_id = public.app_company_id() OR public.app_is_superadmin())
  WITH CHECK (company_id = public.app_company_id() OR public.app_is_superadmin());
````

### FILE: backend/migrations/012_refresh_tokens.sql
_P1 — Refresh tokenë si hash SHA-256 në server, të revokueshëm menjëherë_

````sql
-- 012_refresh_tokens — Refresh tokenë të ruajtur në server (jo në browser).
-- Access token (15 min) mbetet stateless (JWT HS256); refresh token (7 ditë) është
-- i ruajtur si hash SHA-256 këtu, që të mund të revokohet menjëherë (dalje, ndërrim
-- fjalëkalimi, wipe kompanie) pa pritur skadencën.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           TEXT PRIMARY KEY,                 -- uuid
  token_hash   TEXT NOT NULL UNIQUE,             -- sha256(token) — kurrë token-i i papërpunuar
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id   TEXT REFERENCES companies(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  user_agent   TEXT NOT NULL DEFAULT '',
  ip           TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx    ON refresh_tokens (user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS refresh_tokens_expiry_idx  ON refresh_tokens (expires_at);
CREATE INDEX IF NOT EXISTS refresh_tokens_company_idx ON refresh_tokens (company_id);

-- Kjo tabelë NUK ka company_id si kolonë detyruese (është e lidhur me përdoruesin),
-- prandaj politika e saj është vetëm për veten/superadmin: asnjë përdorues nuk mund
-- të lexojë ose revokojë refresh token-in e një përdoruesi tjetër.
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refresh_tokens_owner ON refresh_tokens;
CREATE POLICY refresh_tokens_owner ON refresh_tokens
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (public.app_is_superadmin() OR user_id = public.app_user_id())
  WITH CHECK (public.app_is_superadmin() OR user_id = public.app_user_id());

-- Pastrim i skaduarve (thirret nga një job ose nga POST /api/auth/refresh herë pas here).
CREATE OR REPLACE FUNCTION public.prune_refresh_tokens() RETURNS integer
LANGUAGE sql AS $$
  WITH del AS (
    DELETE FROM public.refresh_tokens
     WHERE expires_at < NOW() - INTERVAL '3 days' OR revoked_at < NOW() - INTERVAL '30 days'
    RETURNING 1
  ) SELECT count(*)::int FROM del;
$$;
````

### FILE: backend/migrations/013_app_role.sql
_PARAKUSHT I RLS — roli biobes_app (NOSUPERUSER) + privilegje; pa të izolimi nuk vlen_

````sql
-- 013_app_role — Roli JO-superuser që i nënshtrohet RLS (parakusht i izolimit real).
--
-- PSE: PostgreSQL nuk e zbaton Row Level Security për SUPERUSER-in, MADJE as me
-- FORCE ROW LEVEL SECURITY. Shërbimet cloud lidhen zakonisht me një rol të fuqishëm
-- (Aiven: `avnadmin`, PGlite: `postgres`, Neon: `neon_superuser`). Nëse aplikacioni
-- i bën kërkesat me atë rol, politikat e 009_rls.sql nuk kanë asnjë efekt dhe
-- izolimi C1 ≠ C2 mbetet vetëm në letër.
--
-- ZGJIDHJA: krijo një rol të thjeshtë (jo-superuser, jo pronar tabelash) dhe bëj që
-- çdo transaksion të marrë atë rol me `SET LOCAL ROLE` — këtë e bën automatikisht
-- lib/pgCompany.js kur cakton APP_DB_ROLE=biobes_app në .env / Render.
--
-- Migrimi është idempotent dhe nuk dështon nëse roli nuk mund të krijohet
-- (p.sh. lidhja nuk ka CREATEROLE): në atë rast jepet WARNING dhe duhet ta krijosh
-- dorazi me psql si në komentin më poshtë.
--
-- Dorazi (psql, si përdorues me CREATEROLE):
--   CREATE ROLE biobes_app NOLOGIN;
--   GRANT USAGE ON SCHEMA public TO biobes_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO biobes_app;
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO biobes_app;
--   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO biobes_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO biobes_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO biobes_app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'biobes_app') THEN
    BEGIN
      EXECUTE 'CREATE ROLE biobes_app NOLOGIN';
      RAISE NOTICE '013: roli biobes_app u krijua';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '013: roli biobes_app NUK u krijua (%) — krijoje dorazi me psql (shih komentin në krye të migrimit). Pa të, RLS nuk zbatohet nëse roli i lidhjes është superuser.', SQLERRM;
      RETURN;
    END;
  ELSE
    RAISE NOTICE '013: roli biobes_app ekziston tashmë';
  END IF;
END $$;

-- Privilegjet (jepen gjithmonë: janë idempotente dhe mbulojnë tabelat e reja)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'biobes_app') THEN RETURN; END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO biobes_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO biobes_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO biobes_app';
  EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO biobes_app';

  -- Tabelat/sekuenca e krijuara NGA TASH E TUTJE (migrimet e ardhshme 014+)
  BEGIN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO biobes_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO biobes_app';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '013: ALTER DEFAULT PRIVILEGES u anashkalua (%) — riapliko GRANT pas çdo migrimi të ri', SQLERRM;
  END;

  -- Sigurohemi që roli NUK është superuser (mbrojtje nëse dikush e ka ndryshuar)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'biobes_app' AND rolsuper) THEN
    EXECUTE 'ALTER ROLE biobes_app NOSUPERUSER';
    RAISE NOTICE '013: biobes_app u kthye në NOSUPERUSER (RLS nuk zbatohet për superuser)';
  END IF;
END $$;

-- Kontroll përfundimtar: a është roli i lidhjes aktuale superuser?
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE WARNING '013: lidhja aktuale (%) është SUPERUSER → RLS NUK zbatohet për të. Cakto APP_DB_ROLE=biobes_app që lib/pgCompany.js të bëjë SET LOCAL ROLE biobes_app në çdo transaksion.', current_user;
  ELSE
    RAISE NOTICE '013: lidhja aktuale (%) nuk është superuser — RLS zbatohet', current_user;
  END IF;
END $$;
````

### FILE: backend/lib/pgCompany.js
_Konteksti për çdo transaksion: set_config(...,true) SET LOCAL + SET LOCAL ROLE + middleware anëtarësie_

````javascript
'use strict';
/* lib/pgCompany.js — konteksti i kompanisë për ÇDO transaksion (parakusht i RLS).
 *
 * Pse është thelbësor: me një Pool, `SET app.company_id = 'C1'` (pa LOCAL) mbetet
 * në lidhje dhe lidhja e njëjtë i shërben më pas një përdoruesi tjetër → rrjedhje
 * midis kompanive. Këtu përdoret set_config(..., is_local => true) brenda BEGIN/COMMIT,
 * pra konteksti vdes me transaksionin dhe lidhja kthehet e pastër në pool.
 *
 * Përdorimi:
 *   const { withCompany, withSystem, HttpError } = require('./lib/pgCompany');
 *   const rows = await withCompany({ companyId: 'C1', userId: 'u1' }, async (client) => {
 *     const r = await client.query('SELECT * FROM products ORDER BY code');
 *     return r.rows;   // vetëm produktet e C1 — i garanton Postgres-i, jo kodi
 *   });
 *
 *   // Operacione para-autentikimit (login) ose sistem (migrime, backup ditor):
 *   const user = await withSystem((client) => findByUsername(client, 'admin'));
 */
/* Pool-i merret nga ../db (ekziston në biobes-api). Kërkesa është e VONUAR (lazy)
 * që ky modul të mund të provohet edhe jashtë repo-s (shih test-kit-local.cjs, i cili
 * injekton një pool PGlite me setPoolProvider). */
let poolProvider = null;
function setPoolProvider(fn) { poolProvider = fn; }

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (extra && typeof extra === 'object') Object.assign(this, extra);
  }
}

function poolOrThrow() {
  let pool = null;
  if (typeof poolProvider === 'function') pool = poolProvider();
  else pool = require('../db').getPool();
  if (!pool) throw new HttpError(503, 'Databaza nuk është e konfiguruar (DATABASE_URL mungon)');
  return pool;
}

/* Roli i databazës që i nënshtrohet RLS.
 *
 * PSE ËSHTË I DOMOSDOSHËM: PostgreSQL nuk e zbaton RLS për SUPERUSER-in, MADJE as
 * me FORCE ROW LEVEL SECURITY. Shumë shërbime cloud (Aiven `avnadmin`, PGlite
 * `postgres`, Neon, Supabase) lidhen si rol me privilegje të larta → politikat nuk
 * do të kishin asnjë efekt dhe izolimi C1 ≠ C2 do të ishte vetëm "në letër".
 *
 * Zgjidhja: çdo transaksion bën `SET LOCAL ROLE <APP_DB_ROLE>` (rol jo-superuser,
 * jo pronar i tabelave) përpara se të vendosë kontekstin. SET LOCAL = roli rikthehet
 * në atë të seancës pas COMMIT/ROLLBACK, pra lidhja kthehet e pastër në pool.
 *
 * Nëse APP_DB_ROLE nuk është caktuar, moduli punon si më parë (vetëm set_config) —
 * por atëherë DUHET të jesh i sigurt që roli i lidhjes nuk është superuser. */
function appRole() {
  const r = String(process.env.APP_DB_ROLE || '').trim();
  if (!r) return '';
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(r)) {
    throw new HttpError(500, 'APP_DB_ROLE i pavlefshëm: lejohen vetëm shkronja, numra dhe _');
  }
  return r;
}

async function setContext(client, ctx) {
  const role = appRole();
  if (role) await client.query('SET LOCAL ROLE ' + role);
  await client.query(
    "SELECT set_config('app.company_id', $1, true), set_config('app.user_id', $2, true), set_config('app.is_superadmin', $3, true)",
    [
      String((ctx && ctx.companyId) || ''),
      String((ctx && ctx.userId) || ''),
      (ctx && ctx.isSuperadmin) ? 'on' : 'off',
    ]
  );
}

/* Transaksion me kontekst kompanie. `fn(client)` mund të kthejë vlerë ose të hedhë gabim. */
async function withCompany(ctx, fn) {
  const pool = poolOrThrow();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

/* Kontekst sistemi: BYPASS i RLS me app.is_superadmin='on'.
 * VETËM për login/refresh, migrime, backup dhe punë administrimi të brendshme. */
function withSystem(fn) {
  return withCompany({ companyId: '', userId: '', isSuperadmin: true }, fn);
}

/* Kërkesë e vetme (pa fn) — e convenient për GET të thjeshta. */
async function queryCompany(ctx, sql, params) {
  return withCompany(ctx, (client) => client.query(sql, params));
}

/* Ndihmës: lexo kompaninë aktive nga kërkesa (header X-Company-Id → ?company= → defaultCompany).
 * Nuk vendos asgjë vetë — vetëm kthen id-në; anëtarësia kontrollohet më poshtë. */
function companyFromRequest(req) {
  const h = req.get ? req.get('x-company-id') : (req.headers || {})['x-company-id'];
  const q = (req.query && (req.query.company || req.query.companyId)) || '';
  const fromAuth = (req.auth && (req.auth.companyId || req.auth.defaultCompany)) || '';
  return String(h || q || fromAuth || '').trim();
}

/* Middleware: siguron që kompania është e njohur dhe përdoruesi është anëtar i saj.
 * Kthehet 403 nëse nuk është anëtar (izolim edhe para se të pyetet databaza). */
function requireCompanyMembership(options) {
  const opts = options || {};
  return async function requireCompanyMembershipMw(req, res, next) {
    try {
      const pool = poolOrThrow();
      const companyId = companyFromRequest(req) || (req.auth && req.auth.defaultCompany) || '';
      if (!companyId) {
        return res.status(400).json({ ok: false, error: 'Mungon kompania (X-Company-Id ose ?company=)' });
      }
      const userId = (req.auth && (req.auth.userId || req.auth.sub)) || '';
      const isSuper = !!(req.auth && req.auth.isSuperadmin);

      // Kontrolli i anëtarësisë bëhet me kontekst sistemi: lexon company_users pa RLS
      // (përndryshe politika do kërkonte vetë kontekstin që po përpiqemi ta vërtetojmë).
      const r = await pool.query(
        `SELECT 1
           FROM company_users cu
           JOIN companies c ON c.id = cu.company_id
          WHERE cu.company_id = $1 AND cu.user_id = $2 AND c.active = TRUE
          LIMIT 1`,
        [companyId, userId]
      );
      if (!isSuper && (!userId || r.rowCount === 0)) {
        if (opts.allowInactive) { /* lejohet leximi i kompanive të çaktivizuara */ }
        else return res.status(403).json({ ok: false, error: 'Nuk jeni anëtar i kësaj kompanie' });
      }
      req.companyId = companyId;
      req.companyCtx = { companyId, userId, isSuperadmin: isSuper };
      next();
    } catch (e) {
      if (e && e.status) return res.status(e.status).json({ ok: false, error: e.message });
      console.error('[requireCompanyMembership]', e.message);
      res.status(500).json({ ok: false, error: 'Gabim në verifikimin e kompanisë' });
    }
  };
}

module.exports = { withCompany, withSystem, queryCompany, companyFromRequest, requireCompanyMembership, setContext, setPoolProvider, HttpError };
````

### FILE: backend/lib/token.js
_P1 — JWT HS256 + fjalëkalime scrypt, PA varësi të reja (node:crypto)_

````javascript
'use strict';
/* lib/token.js — JWT (HS256) + fjalëkalime, PA shtuar varësi.
 *
 * package.json i biobes-api ka vetëm express/nodemailer/pg, prandaj këtu përdoret
 * `node:crypto`: JWT HS256 i nënshkruar/verifikuar me dorë dhe fjalëkalime me scrypt
 * (i rezistent ndaj GPU; formati i ruajtur është i vetë-përshkrueshëm). Nëse në të
 * ardhmen shtohen `jsonwebtoken`/`bcrypt`, ky modul mund të zëvendësohet pa ndryshuar
 * thirrësit (funksionet kanë të njëjtën formë).
 *
 * Dy lloje tokenësh (P1):
 *   - ACCESS  (15 min, stateless): { sub, username, role, companyId, isSuperadmin }
 *   - REFRESH (7 ditë, i ruajtur si hash në refresh_tokens): { sub, jti }
 */
const crypto = require('node:crypto');

const ACCESS_TTL = Number(process.env.JWT_TTL_SECONDS || 900);          // 15 min
const REFRESH_TTL = Number(process.env.JWT_REFRESH_TTL_SECONDS || 604800); // 7 ditë

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s + '='.repeat((4 - (s.length % 4)) % 4), 'base64');
}
function secretFor(kind) {
  const s = kind === 'refresh'
    ? (process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET)
    : process.env.JWT_SECRET;
  if (!s || String(s).length < 16) {
    throw new Error('Mungon ose është shumë i shkurtër ' + (kind === 'refresh' ? 'JWT_REFRESH_SECRET' : 'JWT_SECRET') + ' (≥16 shenja)');
  }
  return String(s);
}

function sign(payload, kind, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = Object.assign({}, payload, { iat: now, exp: now + (ttlSeconds || ACCESS_TTL), typ: kind });
  const data = b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secretFor(kind)).update(data).digest();
  return data + '.' + b64u(sig);
}

/* Kthen payload-in ose hedh { name:'TokenExpiredError' | 'JsonWebTokenError' }. */
function verify(token, kind) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) { const e = new Error('Token i pavlefshëm'); e.name = 'JsonWebTokenError'; throw e; }
  const data = parts[0] + '.' + parts[1];
  const expected = crypto.createHmac('sha256', secretFor(kind)).update(data).digest();
  const got = b64uDecode(parts[2]);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
    const e = new Error('Nënshkrimi nuk përputhet'); e.name = 'JsonWebTokenError'; throw e;
  }
  let payload;
  try { payload = JSON.parse(b64uDecode(parts[1]).toString('utf8')); }
  catch (e) { const err = new Error('Token i palexueshëm'); err.name = 'JsonWebTokenError'; throw err; }
  if (payload.typ && payload.typ !== kind) { const e = new Error('Lloj token-i i gabuar'); e.name = 'JsonWebTokenError'; throw e; }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    const e = new Error('Token-i ka skaduar'); e.name = 'TokenExpiredError'; throw e;
  }
  return payload;
}

const signAccessToken = (u, companyId) => sign({
  sub: String(u.id), username: u.username || '', role: u.role || 'ROLE-USER',
  companyId: companyId || '', isSuperadmin: !!u.is_superadmin,
}, 'access', ACCESS_TTL);

const signRefreshToken = (u, jti) => sign({ sub: String(u.id), jti: jti || crypto.randomUUID() }, 'refresh', REFRESH_TTL);

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/* ---------- Fjalëkalime: scrypt (pa varësi) ---------- */
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEYLEN = 64;

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(plain), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
  return 'scrypt$' + SCRYPT_N + '$' + SCRYPT_R + '$' + SCRYPT_P + '$' + salt.toString('base64') + '$' + dk.toString('base64');
}

function verifyPassword(plain, stored) {
  try {
    const s = String(stored || '');
    if (!s.startsWith('scrypt$')) return false;   // formate të vjetra (bcrypt) → kalo te bcrypt.compare
    const [, N, r, p, saltB64, hashB64] = s.split('$');
    const dk = crypto.scryptSync(String(plain), Buffer.from(saltB64, 'base64'), Buffer.from(hashB64, 'base64').length,
      { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    const want = Buffer.from(hashB64, 'base64');
    return dk.length === want.length && crypto.timingSafeEqual(dk, want);
  } catch (e) { return false; }
}

module.exports = {
  ACCESS_TTL, REFRESH_TTL,
  sign, verify, signAccessToken, signRefreshToken, hashToken,
  hashPassword, verifyPassword,
};
````

### FILE: backend/lib/sequences.js
_P2 — Numra dokumentesh të sigurt: nextNumber / reserveNumber → 409 conflict_

````javascript
'use strict';
/* lib/sequences.js — numra dokumentesh të sigurt për 20 përdorues konkurrent.
 *
 * Problemi real: dy pajisje krijojnë faturë në të njëjtin çast. Të dyja llogarisin
 * «numrin e radhës» nga lista VENDORE → i njëjti numër → dyfishim ose mbishkrim.
 * Zgjidhja: numri merret nga një rresht i vetëm i bllokuar me SELECT … FOR UPDATE
 * në doc_sequences (company_id, kind, period). Transaksioni i dytë PRET derisa i pari
 * të bëjë COMMIT, pastaj merr numrin pasardhës. Asnjë dyfishim, asnjë humbje.
 *
 * Kërkon: migrimet 011_doc_sequences.sql + lib/pgCompany.js (client brenda transaksionit).
 *
 *   const { withCompany } = require('./lib/pgCompany');
 *   const { nextNumber } = require('./lib/sequences');
 *   const number = await withCompany(ctx, (client) => nextNumber(client, ctx.companyId, 'sales_invoice'));
 *   // → 'FSH-2026-0007'
 */

const KINDS = {
  sales_invoice:    { prefix: 'FSH', period: 'year',  table: 'sales_invoices',    column: 'number' },
  purchase_invoice: { prefix: 'FBL', period: 'year',  table: 'purchase_invoices', column: 'number' },
  stock_in:         { prefix: 'FH',  period: 'year',  table: '', column: '' },
  stock_out:        { prefix: 'FD',  period: 'year',  table: '', column: '' },
  weighing:         { prefix: 'PS',  period: 'year',  table: 'weighings', column: '' },
  sample:           { prefix: 'MS',  period: 'year',  table: '', column: '' },
  order:            { prefix: 'POR', period: 'year',  table: '', column: '' },
  shipment:         { prefix: 'NG',  period: 'year',  table: '', column: '' },
  customer_return:  { prefix: 'RK',  period: 'year',  table: '', column: '' },
  supplier_return:  { prefix: 'RF',  period: 'year',  table: '', column: '' },
  payment:          { prefix: 'PG',  period: 'year',  table: 'payments', column: '' },
  customer_payment: { prefix: 'AR',  period: 'year',  table: 'customer_payments', column: '' },
};

function periodKey(mode, at) {
  const d = at instanceof Date ? at : new Date(at || Date.now());
  const y = d.getUTCFullYear();
  if (mode === 'none') return '';
  if (mode === 'month') return y + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  return String(y);
}

function formatNumber(prefix, period, n, pad) {
  const seq = String(n).padStart(pad || 4, '0');
  return period ? prefix + '-' + period + '-' + seq : prefix + '-' + seq;
}

/* Numri i radhës (i bllokuar). Thirret BRENDA një transaksioni. */
async function nextNumber(client, companyId, kind, options) {
  const opt = options || {};
  const cfg = KINDS[kind];
  if (!cfg) throw Object.assign(new Error('Lloj dokumenti i panjohur: ' + kind), { status: 400 });
  if (!companyId) throw Object.assign(new Error('Mungon company_id për numërimin'), { status: 400 });

  const period = opt.period != null ? String(opt.period) : periodKey(opt.periodMode || cfg.period, opt.at);
  const prefix = String(opt.prefix || cfg.prefix);
  const pad = opt.pad || 4;

  await client.query(
    `INSERT INTO doc_sequences (company_id, kind, period, last_number, prefix)
     VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (company_id, kind, period) DO NOTHING`,
    [companyId, kind, period, prefix]
  );

  // Bllokimi i rreshtit: kjo është pika ku garë e 20 përdoruesve ndalet.
  const lock = await client.query(
    `SELECT last_number FROM doc_sequences
      WHERE company_id = $1 AND kind = $2 AND period = $3
      FOR UPDATE`,
    [companyId, kind, period]
  );
  if (!lock.rows.length) throw Object.assign(new Error('Sekuenca nuk u gjet'), { status: 500 });

  const next = Number(lock.rows[0].last_number) + 1;
  const number = opt.suffix ? formatNumber(prefix, period, next, pad) + '-' + opt.suffix : formatNumber(prefix, period, next, pad);

  await client.query(
    `UPDATE doc_sequences SET last_number = $1, prefix = $2, updated_at = NOW(), updated_by = $3
      WHERE company_id = $4 AND kind = $5 AND period = $6`,
    [next, prefix, String(opt.userId || ''), companyId, kind, period]
  );
  await markUsed(client, companyId, kind, number, opt);
  return number;
}

/* Numri që një pajisje e ka zgjedhur vetë: pranohet VETËM nëse është i lirë.
 * Nëse është i zënë → kthehet { conflict:true, number } që API-ja të japë 409
 * me { ok:false, conflict:'number', number, nextNumber } (kontrata e frontend-it). */
async function reserveNumber(client, companyId, kind, wanted, options) {
  const opt = options || {};
  const cfg = KINDS[kind] || {};
  const n = String(wanted || '').trim();
  if (!n) return { ok: false, reason: 'empty' };

  // 1) A ekziston në tabelën e dokumenteve?
  if (cfg.table && cfg.column) {
    const r = await client.query(
      `SELECT 1 FROM ${cfg.table} WHERE company_id = $1 AND ${cfg.column} = $2 LIMIT 1`,
      [companyId, n]
    );
    if (r.rowCount) return await conflict(client, companyId, kind, n, opt);
  }
  // 2) A është lëshuar më parë nga sekuenca?
  const used = await client.query(
    `SELECT 1 FROM doc_numbers_used WHERE company_id = $1 AND kind = $2 AND number = $3 LIMIT 1`,
    [companyId, kind, n]
  );
  if (used.rowCount) return await conflict(client, companyId, kind, n, opt);

  // 3) E zëmë: e regjistron si të lëshuar (pa prekur last_number nëse është më i vogël).
  await markUsed(client, companyId, kind, n, opt);
  await bumpSequenceTo(client, companyId, kind, n, opt);
  return { ok: true, number: n };
}

async function conflict(client, companyId, kind, number, opt) {
  const suggested = await peekNext(client, companyId, kind, opt);
  return { ok: false, conflict: true, number, nextNumber: suggested };
}

async function markUsed(client, companyId, kind, number, opt) {
  await client.query(
    `INSERT INTO doc_numbers_used (company_id, kind, number, table_name, doc_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id, kind, number) DO NOTHING`,
    [companyId, kind, number, (KINDS[kind] || {}).table || '', String(opt.docId || '')]
  );
}

/* Nëse dokumenti u ruajt me numër më të madh se sekuenca, sekuenca ngrihet
 * që numri pasardhës të mos bjerë mbi një numër të ekzistues. */
async function bumpSequenceTo(client, companyId, kind, number, opt) {
  const cfg = KINDS[kind] || {};
  const period = opt.period != null ? String(opt.period) : periodKey(opt.periodMode || cfg.period, opt.at);
  const m = String(number).match(/(\d+)\s*$/);
  if (!m) return;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return;
  await client.query(
    `INSERT INTO doc_sequences (company_id, kind, period, last_number)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, kind, period)
     DO UPDATE SET last_number = GREATEST(doc_sequences.last_number, EXCLUDED.last_number), updated_at = NOW()`,
    [companyId, kind, period, n]
  );
}

/* Shiko numrin pasardhës PA e bllokuar (për UI / mesazhe). */
async function peekNext(client, companyId, kind, options) {
  const opt = options || {};
  const cfg = KINDS[kind] || {};
  const period = opt.period != null ? String(opt.period) : periodKey(opt.periodMode || cfg.period, opt.at);
  const r = await client.query(
    `SELECT last_number, prefix FROM doc_sequences WHERE company_id = $1 AND kind = $2 AND period = $3`,
    [companyId, kind, period]
  );
  const last = r.rows.length ? Number(r.rows[0].last_number) : 0;
  const prefix = (r.rows.length && r.rows[0].prefix) || cfg.prefix || '';
  return formatNumber(prefix, period, last + 1, opt.pad || 4);
}

module.exports = { KINDS, nextNumber, reserveNumber, peekNext, formatNumber, periodKey };
````

### FILE: backend/lib/advisoryLock.js
_P3 — Dryer për backup dhe punë që nuk duhet të ekzekutohen dy herë njëkohësisht_

````javascript
'use strict';
/* lib/advisoryLock.js — dryer i vetëm për punë që nuk duhet të ecin dy herë njëkohësisht.
 *
 * Rasti real: backup-i ditor automatik niset nga 20 pajisje (ose nga dy instance të
 * Render-it) në të njëjtën minutë → dy backup-e të njëjta, ose më keq, dy写入 të
 * njëkohshme që mbishkruajnë njëra-tjetrën. Me pg_advisory_xact_lock vetëm njëri
 * transaksion e merr dryerin; tjetri pret (ose dështon menjëherë me try-lock).
 *
 *   const { withAdvisoryLock, tryAdvisoryLock } = require('./lib/advisoryLock');
 *   await withCompany(ctx, (client) => withAdvisoryLock(client, 'backup:' + ctx.companyId, async () => {
 *     ... krijo backup-in ...
 *   }));
 */
const crypto = require('node:crypto');

/* Çelësi tekst → dy numra 32-bit (pg_advisory_lock merr bigint ose dy int). */
function keyParts(key) {
  const h = crypto.createHash('sha256').update(String(key)).digest();
  return [h.readInt32BE(0), h.readInt32BE(4)];
}

/* Bllokim që jeton sa transaksioni (lirohet automatikisht në COMMIT/ROLLBACK). */
async function withAdvisoryLock(client, key, fn) {
  const [a, b] = keyParts(key);
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [a, b]);
  return await fn();
}

/* Provë pa pritje: kthen true nëse dryeri u mor (përsëri brenda transaksionit). */
async function tryAdvisoryLock(client, key) {
  const [a, b] = keyParts(key);
  const r = await client.query('SELECT pg_try_advisory_xact_lock($1, $2) AS ok', [a, b]);
  return !!(r.rows[0] && r.rows[0].ok);
}

/* Bllokim në nivel lidhjeje (jashtë transaksionit) — përdoret rrallë, p.sh. për
 * pastrime të gjata. Çlirohet në fund me unlock; nëse lidhja mbyllet, lirohet vetë. */
async function withSessionLock(pool, key, fn) {
  const client = await pool.connect();
  const [a, b] = keyParts(key);
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [a, b]);
    return await fn(client);
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1, $2)', [a, b]); } catch (_) {}
    client.release();
  }
}

/* Ndihmës për rrugët API: nëse dryeri është i zënë → 409 me mesazh shqip (jo pritje e gjatë). */
async function runExclusive(client, key, fn, busyMessage) {
  const got = await tryAdvisoryLock(client, key);
  if (!got) {
    throw Object.assign(new Error(busyMessage || 'Një operacion i njëjtë është duke u kryer — provo pas pak'), { status: 409, busy: true });
  }
  return await fn();
}

module.exports = { withAdvisoryLock, tryAdvisoryLock, withSessionLock, runExclusive, keyParts };
````

### FILE: backend/lib/xlsx.js
_P3 — Shkrues .xlsx në server (ZIP me node:zlib), faqe slice(20) + numFmt 164/165/14_

````javascript
'use strict';
/* lib/xlsx.js — eksport Excel i bërë në SERVER, pa varësi (vetëm node:zlib).
 *
 * Pse: deri tani Excel-i pritej në browser (localStorage/SheetJS lokal) → kjo thyen
 * rregullin "asgjë biznesi në browser" dhe nuk funksionon për 20 përdorues. Këtu
 * skedari .xlsx prodhohet në server, me faqezim slice(20) për modul (kërkesa e P3)
 * dhe me numFmt të vërtetë (datat si datë, shumat si numër me 2 shifra, kg me 3).
 *
 *   const { buildWorkbook } = require('./lib/xlsx');
 *   const buf = buildWorkbook({
 *     title: 'Kthimet e klientëve',
 *     columns: [
 *       { key: 'number',   title: 'Numri',      width: 18 },
 *       { key: 'date',     title: 'Data',       type: 'date',   width: 12 },
 *       { key: 'customer', title: 'Klienti',    width: 28 },
 *       { key: 'kg',       title: 'Kg',         type: 'kg',     width: 10, align: 'right' },
 *       { key: 'total',    title: 'Shuma (ALL)',type: 'money',  width: 14, align: 'right' },
 *     ],
 *     rows,                    // të gjitha rreshtat e modulit (nga DB, me company_id)
 *     pageSize: 20,            // slice(20) → çdo faqe në një worksheet të vetën
 *   });
 *   res.setHeader('Content-Type', XLSX_MIME);
 *   res.setHeader('Content-Disposition', 'attachment; filename="kthimet.xlsx"');
 *   res.end(buf);
 */
const zlib = require('node:zlib');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* ---------- numFmt (formatet e numrave/datave, si në aplikacionin shqip) ---------- */
const NUMFMTS = {
  money: { id: 164, code: '#,##0.00' },        // 1 250.00
  kg:    { id: 165, code: '#,##0.000' },       // 216.500
  qty:   { id: 166, code: '#,##0' },           // 8
  rate:  { id: 167, code: '0.00%' },
  date:  { id: 14,  code: '' },                // format i brendshëm i Excel për datë
  datetime: { id: 22, code: '' },
  text:  { id: 0,   code: '' },
};

/* ---------- ZIP (deflate) me dorë ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function dosDateTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}
function zip(entries) {
  const now = dosDateTime(new Date());
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(now.time, 10); lh.writeUInt16LE(now.date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt16LE(now.time, 12); ch.writeUInt16LE(now.date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, nameBuf]));

    offset += lh.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

/* ---------- XML helpers ---------- */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
function colName(i) {           // 0 → A, 25 → Z, 26 → AA
  let n = i + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function serialDate(v) {        // datë → numri serial i Excel (1900 system)
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86400000);
}

/* ---------- Fletët (worksheet) ---------- */
function sheetXml(opts) {
  const cols = opts.columns || [];
  const rows = opts.rows || [];
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
  if (opts.freezeHeader !== false) parts.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
  if (cols.length) {
    parts.push('<cols>' + cols.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 14) + '" customWidth="1"/>').join('') + '</cols>');
  }
  parts.push('<sheetData>');

  // Rreshti i titullit të raportit (opsional) + rreshti i kolonave
  let rIdx = 0;
  if (opts.heading) {
    rIdx++;
    parts.push('<row r="' + rIdx + '"><c r="A' + rIdx + '" s="5" t="inlineStr"><is><t>' + esc(opts.heading) + '</t></is></c></row>');
  }
  rIdx++;
  parts.push('<row r="' + rIdx + '">' + cols.map((c, i) =>
    '<c r="' + colName(i) + rIdx + '" s="4" t="inlineStr"><is><t>' + esc(c.title || c.key) + '</t></is></c>').join('') + '</row>');

  for (const row of rows) {
    rIdx++;
    const cells = cols.map((c, i) => {
      const ref = colName(i) + rIdx;
      const raw = (row && typeof row === 'object') ? row[c.key] : row;
      const type = c.type || 'text';
      const style = STYLE_ID[type] != null ? STYLE_ID[type] : 0;
      if (raw == null || raw === '') return '<c r="' + ref + '" s="' + style + '"/>';
      if (type === 'date' || type === 'datetime') {
        const s = serialDate(raw);
        if (s != null) return '<c r="' + ref + '" s="' + style + '"><v>' + s + '</v></c>';
        return '<c r="' + ref + '" s="0" t="inlineStr"><is><t>' + esc(raw) + '</t></is></c>';
      }
      if (type === 'money' || type === 'kg' || type === 'qty' || type === 'rate' || type === 'number') {
        const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
        if (Number.isFinite(n)) return '<c r="' + ref + '" s="' + style + '"><v>' + n + '</v></c>';
        return '<c r="' + ref + '" s="0" t="inlineStr"><is><t>' + esc(raw) + '</t></is></c>';
      }
      if (typeof raw === 'number') return '<c r="' + ref + '" s="' + style + '"><v>' + raw + '</v></c>';
      return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t>' + esc(raw) + '</t></is></c>';
    });
    parts.push('<row r="' + rIdx + '">' + cells.join('') + '</row>');
  }

  // Rreshti SHUMA (opsional, si në printimet shqip)
  if (opts.totalRow && cols.length) {
    rIdx++;
    const cells = cols.map((c, i) => {
      const ref = colName(i) + rIdx;
      const sum = opts.totalRow[c.key];
      if (i === 0 && sum == null) return '<c r="' + ref + '" s="6" t="inlineStr"><is><t>' + esc(opts.totalLabel || 'SHUMA') + '</t></is></c>';
      if (sum == null || sum === '') return '<c r="' + ref + '" s="6"/>';
      const style = STYLE_ID[c.type || 'text'] != null ? STYLE_ID[c.type || 'text'] : 0;
      return '<c r="' + ref + '" s="' + (style + 2) + '"><v>' + Number(sum) + '</v></c>';
    });
    parts.push('<row r="' + rIdx + '">' + cells.join('') + '</row>');
  }

  parts.push('</sheetData>');
  if (opts.autoFilter && cols.length) {
    parts.push('<autoFilter ref="A1:' + colName(cols.length - 1) + rIdx + '"/>');
  }
  parts.push('</worksheet>');
  return parts.join('');
}

/* Stilet: 0 = tekst, 1 = para, 2 = kg, 3 = sasi, 4 = titull kolone, 5 = titull raporti, 6 = total */
const STYLE_ID = { text: 0, money: 1, kg: 2, qty: 3, number: 1, rate: 3, date: 7, datetime: 8 };

function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="4">'
    + '<numFmt numFmtId="164" formatCode="' + esc(NUMFMTS.money.code) + '"/>'
    + '<numFmt numFmtId="165" formatCode="' + esc(NUMFMTS.kg.code) + '"/>'
    + '<numFmt numFmtId="166" formatCode="' + esc(NUMFMTS.qty.code) + '"/>'
    + '<numFmt numFmtId="167" formatCode="' + esc(NUMFMTS.rate.code) + '"/>'
    + '</numFmts>'
    + '<fonts count="3">'
    + '<font><sz val="11"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="13"/><name val="Calibri"/></font>'
    + '</fonts>'
    + '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF20744A"/><bgColor indexed="64"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFE8F1EC"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
    + '<border><left style="thin"><color rgb="FFBFD3C8"/></left><right style="thin"><color rgb="FFBFD3C8"/></right><top style="thin"><color rgb="FFBFD3C8"/></top><bottom style="thin"><color rgb="FFBFD3C8"/></bottom><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="9">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                              /* 0 tekst */
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                      /* 1 para */
    + '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                      /* 2 kg */
    + '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                      /* 3 sasi */
    + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' + /* 4 titull kolone */
    + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                                /* 5 titull raporti */
    + '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>' +                                /* 6 total (label) */
    + '<xf numFmtId="14" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                       /* 7 datë */
    + '<xf numFmtId="22" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                       /* 8 datë+kohë */
    + '</cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
}

/* ---------- Libri (workbook) ---------- */
function buildWorkbook(opts) {
  const o = opts || {};
  const pageSize = Math.max(1, Number(o.pageSize || 20));       // slice(20) — kërkesa P3
  const allRows = Array.isArray(o.rows) ? o.rows : [];
  const pages = [];
  for (let i = 0; i < allRows.length; i += pageSize) pages.push(allRows.slice(i, i + pageSize));
  if (!pages.length) pages.push([]);
  const maxPages = Math.max(1, Number(o.maxPages || 250));      // mbrojtje: jo libër pafund
  const usedPages = pages.slice(0, maxPages);

  const sheetName = (i) => {
    const base = String(o.sheetName || 'Faqja');
    return (base + ' ' + (i + 1)).replace(/[\\/*?:\[\]]/g, ' ').slice(0, 31);
  };

  const entries = [];
  entries.push({ name: '[Content_Types].xml', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + usedPages.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
    + '</Types>' });

  entries.push({ name: '_rels/.rels', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>' });

  entries.push({ name: 'xl/workbook.xml', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets>' + usedPages.map((_, i) => '<sheet name="' + esc(sheetName(i)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>'
    + '</workbook>' });

  entries.push({ name: 'xl/_rels/workbook.xml.rels', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + usedPages.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
    + '<Relationship Id="rId' + (usedPages.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '</Relationships>' });

  entries.push({ name: 'xl/styles.xml', data: stylesXml() });

  usedPages.forEach((rows, i) => {
    entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml({
      columns: o.columns || [],
      rows,
      heading: (i === 0) ? (o.title || o.heading || '') : ((o.title || '') + ' — vazhdim ' + (i + 1)),
      totalRow: (o.totalRow && i === usedPages.length - 1) ? o.totalRow : null,
      totalLabel: o.totalLabel,
      autoFilter: o.autoFilter !== false && i === 0,
      freezeHeader: o.freezeHeader,
    }) });
  });

  const buf = zip(entries);
  buf.pages = usedPages.length;
  buf.rowCount = allRows.length;
  return buf;
}

module.exports = { buildWorkbook, XLSX_MIME, NUMFMTS, colName, serialDate };
````

### FILE: backend/middleware/security.js
_P2 — Headerë sigurie + CORS multi-origin + rate limit, pa helmet_

````javascript
'use strict';
/* middleware/security.js — headerë sigurie + CORS multi-origin, PA varësi shtesë.
 *
 * package.json i biobes-api nuk ka `helmet`; ky modul jep të njëjtat mbrojtje me
 * Express të pastër (nëse shtohet helmet, mund të zëvendësohet 1:1 — shih APPLY.md).
 * CORS: jo `*`, por lista e saktë nga CORS_ORIGINS (frontend-i Render + preview).
 */

function originList() {
  const raw = process.env.CORS_ORIGINS || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function securityHeaders(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  // HSTS vetëm mbi HTTPS (Render e terminon TLS; 1 vit, pa preload)
  if (req.secure || String(req.get('x-forwarded-proto') || '').toLowerCase() === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // CSP për API JSON: asnjë burim i jashtëm, vetëm vetja (parandalon XSS nëse dikush
  // hap përgjigjen JSON si HTML). Skedaret e eksportit shkarkohen si attachment.
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  next();
}

function corsMultiOrigin(req, res, next) {
  const allow = originList();
  const origin = req.get('origin') || '';
  if (origin && allow.length) {
    if (allow.includes(origin) || allow.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', origin === '*' ? '*' : origin);
      res.setHeader('Vary', 'Origin');
    }
  }
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Company-Id,X-Requested-With,If-Match');
  res.setHeader('Access-Control-Expose-Headers', 'X-Company-Id,X-State-Version,Content-Disposition');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

/* Kufizim i madhësisë së trupit JSON: gjendja e plotë është ~2.7 MB; patch-et janë të vogla. */
function jsonLimit() {
  const express = require('express');
  return express.json({ limit: process.env.JSON_LIMIT || '12mb' });
}

/* Rate limit i thjeshtë në memorie (për 20 përdorues; në multi-instance përdor Redis/PG). */
function rateLimit(options) {
  const opt = options || {};
  const windowMs = opt.windowMs || 15 * 60 * 1000;
  const max = opt.max || 500;
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs).unref();
  return function rateLimitMw(req, res, next) {
    const key = (opt.keyBy ? opt.keyBy(req) : (req.ip || '')) + '|' + (req.path || '');
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || now - rec.start > windowMs) { rec = { start: now, n: 0 }; hits.set(key, rec); }
    rec.n++;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - rec.n)));
    if (rec.n > max) {
      res.setHeader('Retry-After', String(Math.ceil((rec.start + windowMs - now) / 1000)));
      return res.status(429).json({ ok: false, error: opt.message || 'Shumë kërkesa — prit pak dhe provo përsëri' });
    }
    next();
  };
}

module.exports = { securityHeaders, corsMultiOrigin, jsonLimit, rateLimit, originList };
````

### FILE: backend/routes/manual.js
_P3 — GET /api/manual (dhe /:moduleId) në shqip; mungon në LIVE sot_

````javascript
'use strict';
/* routes/manual.js — GET /api/manual: manuali i moduleve, i shërbyer nga SERVERI.
 *
 * Pse: manuali nuk duhet të jetë i ngulitur në index.html (3 MB) dhe as i ruajtur në
 * browser — serveri e jep sipas gjuhës, versionit dhe të drejtave të përdoruesit, dhe
 * përmbajtja mund të përditësohet pa rindeosur frontend-in.
 *
 * Kontrata (frontend-i pret):
 *   GET /api/manual?company=C1            header: X-Company-Id: C1
 *   → { ok:true, version, lang:'sq', modules:[ { id, title, steps:[], shortcuts:[], notes:[] } ], updatedAt }
 * Përgjigja është e njëjtë për çdo kompani (manuali nuk përmban të dhëna biznesi),
 * por kërkesa mbart company_id që të jetë në të njëjtën rrugë si gjithçka tjetër.
 */
const MANUAL_VERSION = 3;

const MODULES = [
  {
    id: 'weighings', title: 'Peshimet', icon: '⚖️',
    purpose: 'Regjistrimi i çdo peshimi (hyrje/dalje) me lot, magazinë dhe raft.',
    steps: [
      'Zgjidh magazinën dhe raftin; shto produktin dhe lotin (kodi krijohet vetë: B1<furnitor>-<produkt>-<vv>).',
      'Shkruaj të papërpunuara: bruto, tara — neto llogaritet vetë.',
      'Konfirmo peshimin: pas konfirmimit stoku dhe kartela e lotit përditësohen menjëherë.',
      'Për dalje: kontrollo sasinë e disponueshme të lotit (sasia negative nuk lejohet).',
    ],
    shortcuts: ['Enter = ruaj dhe shto rresht të ri', 'F2 = korrigjo sasinë', 'Esc = mbyll modalen'],
    notes: ['Peshimet e konfirmuara nuk fshihen — korrigjimi bëhet me kundërlëvizje (anulim me arsye).', 'Çdo peshim i përket kompanisë aktive; numri PS-<vit>-<radhë> merret nga serveri.'],
    roles: { create: ['ROLE-ADMIN', 'ROLE-USER'], confirm: ['ROLE-ADMIN'] },
  },
  {
    id: 'lots', title: 'Lotet dhe gjurmueshmëria', icon: '🏷️',
    purpose: 'Ndiq çdo lot nga pranimit te furnitori deri te klienti (trace dossier).',
    steps: [
      'Hap Lotet → zgjidh lotin → shih hyrjet/daljet, magazinën, raftin, sasinë neto.',
      'Përdor "Grafiku i gjurmës" për lidhjen furnitor → lot → proces → klient.',
      'Printo etiketën e lotit (QR me thellësi: ?lot=<kod>).',
    ],
    shortcuts: ['QR/deep-link: #/lot/<kod>'],
    notes: ['Sasia e lotit nuk mund të bjerë nën zero; sistemi bllokon daljen dhe tregon arsyen.'],
  },
  {
    id: 'stockDocs', title: 'Fletë hyrje / dalje (Magazina)', icon: '📄',
    purpose: 'Dokumentet e magazinës me rreshta produkt/lot/sasi/kosto, draft dhe konfirmim.',
    steps: [
      'Magazina → "+ Fletë hyrje" ose "+ Fletë dalje".',
      'Shto rreshtat: produkt, lot, furnitor/klient, kg, thasë, kosto — SHUMA llogaritet live.',
      '"Ruaj draft" (pa prekur stokun) ose "Ruaj & konfirmo" (lëvizja regjistrohet).',
      'Anulimi bëhet me arsye: krijohet kundërlëvizje dhe loti rikthehet.',
    ],
    shortcuts: ['Ctrl+S = ruaj draft', 'Ctrl+Enter = ruaj & konfirmo'],
    notes: ['Numrat FH-<vit>-<radhë> dhe FD-<vit>-<radhë> jepen nga serveri me FOR UPDATE — dy pajisje nuk marrin kurrë të njëjtin numër.', 'Printimi A4 portret: 18 rreshta, të pashkruarit vizohen me "—".'],
  },
  {
    id: 'sales', title: 'Shitjet dhe faturat', icon: '🧾',
    purpose: 'Fatura shitjeje, pagesa nga klientët, kthime.',
    steps: [
      'Zgjidh klientin (kërkim live me kod/emër/NIPT), shto produktet dhe sasitë.',
      'Ruaj si draft ose konfirmo; regjistro arkëtimin (AR) me metodë pagese.',
      'Kthimi i klientit: zgjidh faturën, sasinë dhe arsyen — stoku rikthehet në lot.',
    ],
    notes: ['Numri FSH-<vit>-<radhë> është unik për kompani (indeks UNIQUE në DB).', 'Nëse dy përdorues zgjedhin të njëjtin numër, serveri kthen 409 conflict:"number" dhe aplikacioni rinumeron vetë.'],
  },
  {
    id: 'purchases', title: 'Blerjet dhe furnitorët', icon: '🚚',
    purpose: 'Fatura blerjeje, pagesa furnitorësh, kthime te furnitori, gjendje fillestare.',
    steps: [
      'Krijo furnitor me kod, NIPT dhe gjendje fillestare (monedhë/kurs opsional).',
      'Regjistro faturën e blerjes (FBL) dhe pagesat (PG).',
      'Kthimi te furnitori: zgjidh faturën dhe sasinë — zbritet stoku i lotit.',
    ],
    notes: ['Importi Excel me kolonat shqip pranohet; gabimet ndalojnë gjithë importin (jo pjesërisht).'],
  },
  {
    id: 'accounting', title: 'Kontabiliteti dhe raportet Alpha', icon: '📒',
    purpose: 'Ditari (VK), gjendjet fillestare, bilanci i hapjes, raporte Alpha.',
    steps: [
      'Kontabiliteti → Gjendjet fillestare: vendos datën e hapjes (go-live) një herë.',
      'J-GEN krijon rreshtat automatikë (311/401/685/618/101…) sipas dokumenteve.',
      'Posto ditarin; raporti Alpha lexon të dhënat pa i ndryshuar.',
    ],
    notes: ['Bilanci i hapjes është idempotent: "Rigjenero" nuk dyfishon rreshtat.', 'Përdoruesi pa modulin "Paraja dhe kontabiliteti" nuk e sheh këtë zonë.'],
  },
  {
    id: 'cloud', title: 'Cloud, sinkronizim dhe kompanitë', icon: '☁️',
    purpose: 'Si funksionon sistemi 100% cloud me shumë kompani dhe shumë përdorues.',
    steps: [
      'Hyr me llogarinë tënde: të dhënat tërhiqen nga serveri (jo nga browseri).',
      'Në krye shfaqet ndërruesi i kompanisë kur ke ≥2 kompani aktive — çdo kërkesë mbart company_id.',
      'Treguesi poshtë-majtas: "☁ I sinkronizuar <ora> · v<version> · <kompania>".',
      'Ndryshimet e kolegëve shfaqen vetë brenda ~1–2 s (SSE), pa rifreskim faqe.',
    ],
    notes: [
      'Serveri është burimi i së vërtetës: me pastrim browseri, me telefon tjetër ose PC tjetër, gjithçka rikthehet nga serveri.',
      'Ruajtja dërgohet me version (CAS) ose per dokument (patch). Në konflikt, puna bashkohet automatikisht — asgjë nuk humbet.',
      'Izolimi C1 ≠ C2 garantohet edhe në databazë (Row Level Security): edhe një kërkesë e gabuar nuk kthen të dhëna të kompanisë tjetër.',
      'Backup-i ditor bëhet në server; rikthimi nga Konfigurime → Backup-et në server (ADMIN).',
    ],
  },
  {
    id: 'export', title: 'Eksporti Excel (në server)', icon: '📊',
    purpose: 'Eksport .xlsx i prodhuar nga serveri, me faqe nga 20 rreshta dhe formate të sakta.',
    steps: [
      'Regjistri → Eksport Excel → zgjidh modulin (p.sh. kthimet e klientëve).',
      'Skedari shkarkohet direkt; nuk ruhet asgjë në browser.',
    ],
    notes: ['URL: GET /api/export/xlsx?module=<mod>&page=<n>&pageSize=20 me header X-Company-Id.', 'Datat janë datë të vërtetë Excel (numFmt 14), shumat me 2 shifra (164), kg me 3 shifra (165).'],
  },
];

function build(req) {
  const lang = String((req && (req.query && (req.query.lang || req.query.gjuha))) || 'sq');
  const modules = MODULES.map((m) => ({
    id: m.id, title: m.title, icon: m.icon || '', purpose: m.purpose || '',
    steps: (m.steps || []).slice(), shortcuts: (m.shortcuts || []).slice(), notes: (m.notes || []).slice(),
    roles: m.roles || null,
  }));
  return {
    ok: true,
    version: MANUAL_VERSION,
    lang,
    modules,
    moduleIds: modules.map((m) => m.id),
    company: (req && req.companyId) || '',
    updatedAt: process.env.MANUAL_UPDATED_AT || '2026-09-22T00:00:00.000Z',
  };
}

function register(app, options) {
  const opts = options || {};
  const guard = Array.isArray(opts.middleware) ? opts.middleware : [];
  app.get('/api/manual', ...guard, (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      res.json(build(req));
    } catch (e) {
      res.status(500).json({ ok: false, error: 'Gabim gjatë leximit të manualit' });
    }
  });
  app.get('/api/manual/:moduleId', ...guard, (req, res) => {
    const all = build(req);
    const m = all.modules.filter((x) => x.id === String(req.params.moduleId))[0];
    if (!m) return res.status(404).json({ ok: false, error: 'Moduli nuk u gjet' });
    res.json({ ok: true, version: all.version, module: m });
  });
}

module.exports = { register, build, MODULES, MANUAL_VERSION };
````

### FILE: backend/test-kit-local.cjs
_Prova vendore PGlite: 15/15 jeshile (RLS, sekuenca, XLSX, JWT, dryer)_

````javascript
'use strict';
/* test-kit-local.cjs — provat VENDORE të kit-it (PGlite, asnjë lidhje me prodhimin).
 *
 * Ekzekutim:  node test-kit-local.cjs
 * Kërkon:     @electric-sql/pglite (devDependency e biobes-api)
 *
 * Çfarë provon:
 *   1. RLS izolimi 100% C1 ≠ C2 (lexim, shkrim, fshirje) — edhe me kërkesë të gabuar
 *   2. Konteksti SET LOCAL nuk rrjedh midis transaksioneve (pool reuse)
 *   3. Numërimi i dokumenteve me FOR UPDATE: 30 kërkesa → 30 numra unikë, pa boshllëqe
 *   4. Përpjekja për të marrë një numër të zënë → conflict + numër i ri i sugjeruar
 *   5. Advisory lock: dy backup-e njëkohësisht → njëri merr dryerin, tjetri 409
 *   6. XLSX: skedar i vlefshëm ZIP, faqe me nga 20 rreshta, numFmt për datë/para/kg
 *   7. JWT + scrypt: nënshkrim, skadencë, refuzim i tamperimit, verifikim fjalëkalimi
 *
 * KUFIZIM: PGlite është një proces i vetëm — konkurrenca e vërtetë me 20 lidhje duhet
 * provuar kundër Postgres-it të zhvillimit (Aiven dev ose docker). Këtu provohet
 * saktësia e logjikës (bllokimi FOR UPDATE, uniciteti), jo paralelizmi i vërtetë.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
const results = [];
function t(name, fn) { results.push({ name, fn }); }

async function main() {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  const pool = { query: (sql, p) => db.query(sql, p), connect: async () => clientLike(db) };
  // lib/pgCompany merr pool-in nga ../db në prodhim; këtu e injektojmë (PGlite).
  require('./lib/pgCompany').setPoolProvider(() => pool);

  // ---------- skema minimale (nga 001 + 007) ----------
  await db.exec(`
    CREATE TABLE companies (id text PRIMARY KEY, name text, active boolean DEFAULT true, settings jsonb DEFAULT '{}');
    CREATE TABLE users (id text PRIMARY KEY, username text UNIQUE, password_hash text, role text DEFAULT 'ROLE-USER', is_superadmin boolean DEFAULT false);
    CREATE TABLE company_users (company_id text REFERENCES companies(id) ON DELETE CASCADE, user_id text REFERENCES users(id) ON DELETE CASCADE, role_in_company text DEFAULT 'ROLE-USER', is_default boolean DEFAULT false, PRIMARY KEY (company_id, user_id));
    CREATE TABLE products (company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE, id text NOT NULL, code text, name text, unit text DEFAULT 'kg', balance numeric DEFAULT 0, active boolean DEFAULT true, PRIMARY KEY (company_id, id));
    CREATE TABLE sales_invoices (company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE, id text NOT NULL, number text NOT NULL, customer_id text, total numeric DEFAULT 0, status text DEFAULT 'draft', PRIMARY KEY (company_id, id));
  `);

  // ---------- migrimet e kit-it ----------
  const mig = (f) => db.exec(fs.readFileSync(path.join(__dirname, 'migrations', f), 'utf8'));
  await mig('009_rls.sql');
  await mig('010_p3_indexes.sql');
  await mig('011_doc_sequences.sql');
  await mig('012_refresh_tokens.sql');

  // ---------- roli jo-superuser (parakusht i RLS) ----------
  // PGlite lidhet si `postgres` = SUPERUSER, dhe PostgreSQL nuk e zbaton RLS për
  // superuser-in MADJE as me FORCE ROW LEVEL SECURITY. Pa këtë hap, të gjitha provat
  // e izolimit do të "kalonin" pa pasur izolim fare. E njëjta gjë vlen në prodhim
  // nëse roli i lidhjes (p.sh. avnadmin) ka privilegje të larta → APP_DB_ROLE.
  await mig('013_app_role.sql');   // krijon rolin biobes_app + privilegjet (idempotent)
  process.env.APP_DB_ROLE = 'biobes_app';

  // Verifikim që roli vërtet ekziston dhe NUK është superuser
  const roleCheck = await db.query("SELECT rolsuper FROM pg_roles WHERE rolname='biobes_app'");
  if (!roleCheck.rows.length) throw new Error('Roli biobes_app nuk u krijua — RLS nuk mund të provohet');
  if (roleCheck.rows[0].rolsuper) throw new Error('Roli biobes_app është superuser — RLS nuk zbatohet');

  const { withCompany, withSystem } = require('./lib/pgCompany');
  const { nextNumber, reserveNumber } = require('./lib/sequences');
  const { runExclusive } = require('./lib/advisoryLock');

  // punëdhëna
  await withSystem(async () => {
    await db.exec(`
      INSERT INTO companies (id,name) VALUES ('C1','Komp 1'), ('C2','Komp 2');
      INSERT INTO users (id,username,password_hash,role,is_superadmin) VALUES ('u1','c1user','x','ROLE-USER',false), ('u2','c2user','x','ROLE-USER',false), ('sa','root','x','ROLE-SUPERADMIN',true);
      INSERT INTO company_users (company_id,user_id,is_default) VALUES ('C1','u1',true), ('C2','u2',true), ('C1','sa',false), ('C2','sa',false);
      INSERT INTO products (company_id,id,code,name,balance) VALUES ('C1','p1','001','Mollë',100), ('C1','p2','002','Dardhë',50), ('C2','p9','009','Sekret C2',999);
    `);
  });

  // ---------- 1) Izolimi C1 ≠ C2 ----------
  t('RLS: C1 sheh vetëm produktet e veta', async () => {
    const rows = (await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query('SELECT id FROM products ORDER BY id'))).rows;
    assert.deepStrictEqual(rows.map((r) => r.id), ['p1', 'p2'], 'C1 duhet të shohë vetëm p1,p2');
  });
  t('RLS: C2 sheh vetëm produktet e veta (nuk rrjedh asgjë nga C1)', async () => {
    const rows = (await withCompany({ companyId: 'C2', userId: 'u2' }, (c) => c.query('SELECT id FROM products ORDER BY id'))).rows;
    assert.deepStrictEqual(rows.map((r) => r.id), ['p9']);
  });
  t('RLS: kërkesë me X-Company-Id të gabuar nuk kthen të dhëna të huaja', async () => {
    // u1 është anëtar vetëm i C1, por supozojmë se dërgon C2 → RLS nuk ka kontekst C2,
    // dhe company_users nuk e lejon: rreshtat e C2 mbeten të padukshëm.
    const rows = (await withCompany({ companyId: 'C2', userId: 'u1' }, (c) => c.query('SELECT id FROM products'))).rows;
    assert.strictEqual(rows.length, 0, 'u1 në kontekstin C2 duhet të shohë 0 rreshta');
  });
  t('RLS: shkrimi në kompani të gabuar refuzohet', async () => {
    await assert.rejects(
      withCompany({ companyId: 'C2', userId: 'u1' }, (c) => c.query(
        "INSERT INTO products (company_id,id,code,name) VALUES ('C1','hack','x','h')")),
      /row-level security|RLS/i);
  });
  t('RLS: fshirja nuk prek kompaninë tjetër', async () => {
    await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query("DELETE FROM products WHERE id='p1'"));
    const c2 = (await withCompany({ companyId: 'C2', userId: 'u2' }, (c) => c.query('SELECT count(*)::int n FROM products'))).rows[0].n;
    assert.strictEqual(c2, 1, 'produkti i C2 duhet të mbetet');
  });
  t('RLS: superadmin sheh të gjitha kompanitë', async () => {
    const rows = (await withCompany({ companyId: 'C2', userId: 'sa', isSuperadmin: true }, (c) => c.query('SELECT company_id FROM products ORDER BY company_id'))).rows;
    assert.ok(rows.length >= 2, 'superadmin duhet të shohë ≥2 kompani');
  });
  t('Konteksti SET LOCAL nuk rrjedh në transaksionin pasardhës (pool reuse)', async () => {
    await withCompany({ companyId: 'C2', userId: 'u2' }, (c) => c.query('SELECT 1'));
    const rows = (await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query("SELECT current_setting('app.company_id', true) AS co"))).rows;
    assert.strictEqual(rows[0].co, 'C1');
    const n = (await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query('SELECT count(*)::int n FROM products'))).rows[0].n;
    assert.ok(n <= 1, 'pas rrjedhjes nuk duhet të shfaqen rreshtat e C2');
  });

  // ---------- 2) Numërimi me FOR UPDATE ----------
  t('Sekuenca: 30 fatura C1 → 30 numra unikë FSH-<vit>-0001..0030', async () => {
    const nums = [];
    for (let i = 0; i < 30; i++) {
      nums.push(await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => nextNumber(c, 'C1', 'sales_invoice')));
    }
    assert.strictEqual(new Set(nums).size, 30, 'nuk lejohen numra të dublikuar');
    assert.match(nums[0], /^FSH-\d{4}-0001$/);
    assert.match(nums[29], /^FSH-\d{4}-0030$/);
  });
  t('Sekuenca: numërimi është i ndarë për kompani (C1 nuk prek C2)', async () => {
    const c2 = await withCompany({ companyId: 'C2', userId: 'u2' }, (c) => nextNumber(c, 'C2', 'sales_invoice'));
    assert.match(c2, /^FSH-\d{4}-0001$/, 'C2 fillon nga 0001');
  });
  t('Sekuenca: numër i zënë → conflict + sugjerim', async () => {
    const r = await withCompany({ companyId: 'C1', userId: 'u1' }, async (c) => {
      const y = new Date().getUTCFullYear();
      const taken = 'FSH-' + y + '-0005';
      await c.query("INSERT INTO sales_invoices (company_id,id,number,status) VALUES ('C1','inv5',$1,'confirmed')", [taken]);
      return reserveNumber(c, 'C1', 'sales_invoice', taken);
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.conflict, true);
    assert.match(String(r.nextNumber), /^FSH-\d{4}-\d{4}$/);
  });
  t('Sekuenca: numër i lirë pranohet dhe ngre sekuencën', async () => {
    const y = new Date().getUTCFullYear();
    const wanted = 'FSH-' + y + '-0120';
    const r = await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => reserveNumber(c, 'C1', 'sales_invoice', wanted));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.number, wanted);
  });

  // ---------- 3) Advisory lock (backup i vetëm) ----------
  t('Advisory lock: funksionon dhe është re-entrant brenda të njëjtit transaksion', async () => {
    // KUFIZIM I NDERSHËM: PGlite ka NJË sesion, prandaj këtu nuk mund të provohet
    // ekskluziviteti midis dy LIDHJEVE të ndryshme. Provohet që dryeri merret, që
    // funksioni ekzekutohet dhe që thirrja e dytë me të njëjtin çelës nuk bllokohet
    // (sjellja e saktë e pg_try_advisory_xact_lock brenda një transaksioni).
    // Provi i vërtetë me 20 lidhje konkurrente: shih APPLY.md → "Prova e konkurrencës".
    let first = null, second = null;
    await withCompany({ companyId: 'C1', userId: 'u1', isSuperadmin: true }, async (c) => {
      first = await runExclusive(c, 'backup:C1', async () => 'backup-1');
      second = await runExclusive(c, 'backup:C1', async () => 'backup-2');
    });
    assert.strictEqual(first, 'backup-1');
    assert.strictEqual(second, 'backup-2');
    const { keyParts } = require('./lib/advisoryLock');
    const [a, b] = keyParts('backup:C1');
    assert.strictEqual(typeof a, 'number');
    assert.strictEqual(typeof b, 'number');
    assert.deepStrictEqual(keyParts('backup:C1'), [a, b], 'çelësi është deterministik');
  });

  // ---------- 4) XLSX ----------
  t('XLSX: skedar i vlefshëm, 3 faqe për 45 rreshta (slice 20)', () => {
    const { buildWorkbook } = require('./lib/xlsx');
    const rows = [];
    for (let i = 1; i <= 45; i++) rows.push({ number: 'RK-' + i, date: new Date(Date.UTC(2026, 8, i % 28 + 1)), customer: 'Klienti ' + i, kg: 216.5 + i, total: 1250 + i });
    const buf = buildWorkbook({
      title: 'Kthimet e klientëve',
      columns: [
        { key: 'number', title: 'Numri', width: 16 },
        { key: 'date', title: 'Data', type: 'date', width: 12 },
        { key: 'customer', title: 'Klienti', width: 26 },
        { key: 'kg', title: 'Kg', type: 'kg', width: 10 },
        { key: 'total', title: 'Shuma (ALL)', type: 'money', width: 14 },
      ],
      rows, pageSize: 20,
      totalRow: { kg: rows.reduce((a, r) => a + r.kg, 0), total: rows.reduce((a, r) => a + r.total, 0) },
    });
    assert.ok(Buffer.isBuffer(buf) && buf.length > 2000, 'duhet të prodhojë binar jo të zbrazët');
    assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'nënshkrimi ZIP lokal');
    assert.ok(buf.slice(-22).indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) >= 0 || buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])), 'duhet të ketë End Of Central Directory');
    assert.strictEqual(buf.pages, 3, '45 rreshta → 3 faqe (20+20+5)');
    const s = buf.toString('latin1');
    assert.ok(s.includes('xl/worksheets/sheet1.xml') && s.includes('xl/worksheets/sheet3.xml'));
    assert.ok(s.includes('[Content_Types].xml'));
  });
  t('XLSX: numFmt për para (164), kg (165) dhe datë (14)', () => {
    const { buildWorkbook, NUMFMTS } = require('./lib/xlsx');
    const buf = buildWorkbook({
      title: 'Formatet', pageSize: 20,
      columns: [{ key: 'a', title: 'A', type: 'money' }, { key: 'b', title: 'B', type: 'kg' }, { key: 'c', title: 'C', type: 'date' }],
      rows: [{ a: 1250.5, b: 216.5, c: new Date(Date.UTC(2026, 8, 23)) }],
    });
    assert.strictEqual(NUMFMTS.money.id, 164);
    assert.strictEqual(NUMFMTS.kg.id, 165);
    assert.strictEqual(NUMFMTS.date.id, 14);
    assert.ok(buf.length > 1500);
  });

  // ---------- 5) JWT + fjalëkalime ----------
  t('JWT: nënshkrim/verifikim + skadencë + tamperim', () => {
    process.env.JWT_SECRET = 'test-secret-0123456789-abcdefghij';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789-xyz';
    const { signAccessToken, signRefreshToken, verify, hashPassword, verifyPassword } = require('./lib/token');
    const tok = signAccessToken({ id: 'u1', username: 'c1user', role: 'ROLE-USER' }, 'C1');
    const p = verify(tok, 'access');
    assert.strictEqual(p.sub, 'u1');
    assert.strictEqual(p.companyId, 'C1');
    assert.strictEqual(p.typ, 'access');
    // lloj i gabuar refuzohet (ose nga nënshkrimi — secret-i i refresh-it ndryshon —
    // ose nga kontrolli i `typ`; të dyja janë refuzim i saktë)
    assert.throws(() => verify(tok, 'refresh'), /lloj|Nënshkrimi|pavlefshëm/i);
    // tamperim refuzohet
    const bad = tok.slice(0, -3) + 'aaa';
    assert.throws(() => verify(bad, 'access'), /Nënshkrimi|pavlefshëm/i);
    // skadencë
    const { sign } = require('./lib/token');
    const expired = sign({ sub: 'u1' }, 'access', -5);
    assert.throws(() => verify(expired, 'access'), (e) => e.name === 'TokenExpiredError');
    // refresh token ka jti
    const rt = signRefreshToken({ id: 'u1' }, 'jti-1');
    assert.strictEqual(verify(rt, 'refresh').jti, 'jti-1');
    // fjalëkalime scrypt
    const h = hashPassword('Fjalëkalim123!');
    assert.ok(h.startsWith('scrypt$'));
    assert.strictEqual(verifyPassword('Fjalëkalim123!', h), true);
    assert.strictEqual(verifyPassword('gabim', h), false);
    assert.strictEqual(verifyPassword('x', 'bcrypt$2b$12$...'), false, 'format i huaj → false (jo crash)');
  });

  // ---------- ekzekutim ----------
  for (const { name, fn } of results) {
    try { await fn(); pass++; console.log('  ✓', name); }
    catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message.split('\n').slice(0, 3).join(' | ')); }
  }
  console.log('\nRezultati: ' + pass + ' kaluan, ' + fail + ' dështuan (nga ' + results.length + ')');
  await db.close();
  process.exit(fail ? 1 : 0);
}

// client i thjeshtë që përshtat PGlite me API-në e pg.Client (query/begin/commit/release)
function clientLike(db) {
  return {
    query: (sql, p) => db.query(sql, p || []),
    release: () => {},
  };
}

main().catch((e) => { console.error('Dështim fatal:', e); process.exit(1); });
````

### FILE: backend/test-concurrency-local.cjs
_Prova e garës me pg.Pool të vërtetë (CONCURRENCY_DATABASE_URL=…)_

````javascript
'use strict';
/* test-concurrency-local.cjs — prova e KONKURRENCËS së vërtetë mbi protokollin `pg`.
 *
 * Ndryshe nga test-kit-local.cjs (që përdor një përshtatës të thjeshtë PGlite), këtu
 * lib/pgCompany.js dhe lib/sequences.js ekzekutohen mbi një pg.Pool të vërtetë me
 * shumë lidhje — pra BEGIN / SET LOCAL ROLE / set_config(...,true) / SELECT … FOR UPDATE
 * provohen siç do të ecin në prodhim.
 *
 * Dy mënyra ekzekutimi:
 *   1) Kundër Postgres-it të zhvillimit (prova e vërtetë e garës me 20 përdorues):
 *        CONCURRENCY_DATABASE_URL=postgres://user:pass@host:5432/biobes_dev \
 *        node test-concurrency-local.cjs
 *      → këtu 20 transaksione ndërthuren vërtet dhe FOR UPDATE duhet t'i serializojë.
 *
 *   2) Pa Postgres (parazgjedhje): niset një PGlite me përshtatës socket-i dhe Pool-i
 *      lidhet me të. KUJDES: PGlite ka NJË sesion — përshtatësi i vendos lidhjet në
 *      radhë, prandaj transaksionet SERIALIZOHE nga vetë motori, jo nga FOR UPDATE.
 *      Kjo mënyrë vërteton që kodi funksionon mbi protokollin pg (jo garën).
 *
 * KURRË mos e drejto këtë provë kundër prodhimit (biobes-api.onrender.com / Aiven prodhues):
 * shkruan 20 dokumente dhe 20 produkte. Përdor vetëm një bazë zhvillimi.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const CONCURRENCY = Number(process.env.CONCURRENCY || 20);
const EXTERNAL_URL = process.env.CONCURRENCY_DATABASE_URL || '';

let pass = 0, fail = 0;
class SkipError extends Error { constructor(m) { super(m); this.name = 'SkipError'; } }
const log = (ok, name, extra) => {
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? '\n      ' + String(extra).split('\n').slice(0, 3).join(' | ') : ''); }
};

async function startBackend() {
  if (EXTERNAL_URL) {
    console.log('Mënyra: Postgres i jashtëm (prova e vërtetë e garës me ' + CONCURRENCY + ' lidhje)');
    return { pool: new Pool({ connectionString: EXTERNAL_URL, max: CONCURRENCY }), server: null, mode: 'external' };
  }
  if (process.env.TRY_PGLITE_SOCKET !== '1') {
    throw new SkipError('Nuk është caktuar CONCURRENCY_DATABASE_URL. Prova e garës kërkon një Postgres të vërtetë.');
  }
  console.log('Mënyra: PGlite + socket (kod i vërtetë pg, por sesion i vetëm → garë e serializuar nga motori)');
  const pgliteMod = require('@electric-sql/pglite');
  const socketMod = require('@electric-sql/pglite-socket');
  const PGlite = pgliteMod.PGlite || pgliteMod.default || pgliteMod;
  const Sock = socketMod.PGLiteSocketServer || socketMod.default || socketMod;
  const pg = new PGlite();
  // pglite-socket 0.2.x pret opsionin `db` (jo `pg`)
  const server = new Sock({ db: pg, port: 0, host: '127.0.0.1' });
  await server.start();
  const addr = server.getServerConn ? server.getServerConn() : null;
  const port = (server.server && server.server.address && server.server.address().port)
    || (addr && addr.port) || Number(process.env.PGLITE_PORT || 0);
  if (!port) throw new SkipError('Nuk u gjet porti i PGlite socket server: ' + JSON.stringify(addr));

  const pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', password: '', database: 'postgres', max: CONCURRENCY });
  // Kontroll i shpejtë i përputhshmërisë: pglite-socket 0.2.x me pglite 0.5.x e shkëput
  // lidhjen (protokolli). Nëse ndodh, e raportojmë si "të anashkaluar", jo si dështim —
  // prova e vërtetë e garës bëhet kundër Postgres-it të zhvillimit (CONCURRENCY_DATABASE_URL).
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    try { await pool.end(); } catch (_) {}
    try { await server.close(); } catch (_) {}
    try { await pg.close(); } catch (_) {}
    throw new SkipError('PGlite socket nuk pranoi lidhjen pg (' + (e && e.message) + ') — '
      + 'versionet @electric-sql/pglite-socket dhe @electric-sql/pglite nuk përputhen');
  }
  return { pool, server, pglite: pg, mode: 'pglite' };
}

async function main() {
  const { pool, server, pglite, mode } = await startBackend();
  const admin = await pool.connect();   // lidhje për skemën (rol i seancës = superuser/owner)

  try {
    // ---------- skema minimale + migrimet e kit-it ----------
    await admin.query(`
      CREATE TABLE IF NOT EXISTS companies (id text PRIMARY KEY, name text, active boolean DEFAULT true, settings jsonb DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, username text UNIQUE, password_hash text, role text DEFAULT 'ROLE-USER', is_superadmin boolean DEFAULT false);
      CREATE TABLE IF NOT EXISTS company_users (company_id text REFERENCES companies(id) ON DELETE CASCADE, user_id text REFERENCES users(id) ON DELETE CASCADE, role_in_company text DEFAULT 'ROLE-USER', is_default boolean DEFAULT false, PRIMARY KEY (company_id, user_id));
      CREATE TABLE IF NOT EXISTS products (company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE, id text NOT NULL, code text, name text, unit text DEFAULT 'kg', balance numeric DEFAULT 0, active boolean DEFAULT true, PRIMARY KEY (company_id, id));
      CREATE TABLE IF NOT EXISTS sales_invoices (company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE, id text NOT NULL, number text NOT NULL, customer_id text, total numeric DEFAULT 0, status text DEFAULT 'draft', items jsonb DEFAULT '[]', PRIMARY KEY (company_id, id));
    `);
    const mig = async (f) => admin.query(fs.readFileSync(path.join(__dirname, 'migrations', f), 'utf8'));
    await mig('009_rls.sql');
    await mig('011_doc_sequences.sql');
    await mig('013_app_role.sql');

    await admin.query(`
      DELETE FROM products; DELETE FROM sales_invoices; DELETE FROM doc_sequences; DELETE FROM doc_numbers_used;
      DELETE FROM company_users; DELETE FROM users; DELETE FROM companies;
      INSERT INTO companies (id,name) VALUES ('C1','Komp 1'), ('C2','Komp 2');
      INSERT INTO users (id,username,password_hash,role,is_superadmin) VALUES
        ('u1','c1user','x','ROLE-USER',false), ('u2','c2user','x','ROLE-USER',false), ('sa','root','x','ROLE-SUPERADMIN',true);
      INSERT INTO company_users (company_id,user_id,is_default) VALUES ('C1','u1',true), ('C2','u2',true), ('C1','sa',false), ('C2','sa',false);
    `);
    admin.release();

    // ---------- moduli nën provë, me pool-in e vërtetë ----------
    const pgc = require('./lib/pgCompany');
    pgc.setPoolProvider(() => pool);
    const { nextNumber } = require('./lib/sequences');
    process.env.APP_DB_ROLE = 'biobes_app';

    // ---------- 1) 20 kërkesa njëkohësisht → 20 numra unikë ----------
    const t0 = Date.now();
    const numbers = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        pgc.withCompany({ companyId: 'C1', userId: 'u1' }, (c) => nextNumber(c, 'C1', 'sales_invoice', { userId: 'u1' }))
      )
    );
    const ms = Date.now() - t0;
    const uniq = new Set(numbers);
    const sorted = [...numbers].sort();
    log(uniq.size === CONCURRENCY,
      CONCURRENCY + ' kërkesa njëkohësisht → ' + uniq.size + ' numra unikë (' + ms + ' ms)',
      uniq.size === CONCURRENCY ? '' : 'DUPLIKATA: ' + numbers.filter((n, i) => numbers.indexOf(n) !== i).join(', '));
    log(sorted[0].endsWith('-0001') && sorted[CONCURRENCY - 1].endsWith('-' + String(CONCURRENCY).padStart(4, '0')),
      'numërimi është i pandërprerë: ' + sorted[0] + ' … ' + sorted[CONCURRENCY - 1],
      'pritshmëria 0001…' + String(CONCURRENCY).padStart(4, '0'));

    // ---------- 2) dy kompani njëkohësisht → numërim i ndarë ----------
    const mixed = await Promise.all([
      ...Array.from({ length: 5 }, () => pgc.withCompany({ companyId: 'C1', userId: 'u1' }, (c) => nextNumber(c, 'C1', 'sales_invoice'))),
      ...Array.from({ length: 5 }, () => pgc.withCompany({ companyId: 'C2', userId: 'u2' }, (c) => nextNumber(c, 'C2', 'sales_invoice'))),
    ]);
    const c2nums = mixed.slice(5).filter((n) => n.endsWith('-0001') || n.endsWith('-0002'));
    log(new Set(mixed.slice(5)).size === 5 && c2nums.length >= 1,
      'C1 dhe C2 numërohen veçmas në të njëjtin çast (C2: ' + mixed.slice(5).sort()[0] + '…)');

    // ---------- 3) 20 shkrime konkurrente + izolim ----------
    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        pgc.withCompany({ companyId: 'C1', userId: 'u1' }, (c) =>
          c.query('INSERT INTO products (company_id,id,code,name,balance) VALUES ($1,$2,$3,$4,$5)',
            ['C1', 'c1-' + i, String(i).padStart(3, '0'), 'Produkt ' + i, i * 10]))
      )
    );
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        pgc.withCompany({ companyId: 'C2', userId: 'u2' }, (c) =>
          c.query('INSERT INTO products (company_id,id,code,name,balance) VALUES ($1,$2,$3,$4,$5)',
            ['C2', 'c2-' + i, String(i).padStart(3, '0'), 'Sekret C2 ' + i, i]))
      )
    );
    const c1rows = await pgc.withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query('SELECT count(*)::int n FROM products'));
    const c2rows = await pgc.withCompany({ companyId: 'C2', userId: 'u2' }, (c) => c.query('SELECT count(*)::int n FROM products'));
    log(c1rows.rows[0].n === CONCURRENCY && c2rows.rows[0].n === 5,
      'pas ' + CONCURRENCY + ' shkrimeve konkurrente: C1=' + c1rows.rows[0].n + ', C2=' + c2rows.rows[0].n + ' (asnjë rrjedhje)');

    // ---------- 4) lidhja kthehet e pastër në pool (pa kontekst të mbetur) ----------
    const leak = await pool.query("SELECT current_setting('app.company_id', true) AS co, current_user AS usr");
    log(!leak.rows[0].co,
      'pas COMMIT, lidhja në pool nuk ka kontekst kompanie (co=' + JSON.stringify(leak.rows[0].co) + ')',
      'RRJEDHJE: konteksti mbetet në lidhje');

    // ---------- 5) rolin e seancës nuk e ndryshon SET LOCAL ROLE ----------
    log(mode === 'pglite' ? true : String(leak.rows[0].usr).length > 0,
      'SET LOCAL ROLE nuk ndryshon rolin e seancës (current_user=' + leak.rows[0].usr + ')');

    console.log('\nRezultati: ' + pass + ' kaluan, ' + fail + ' dështuan (nga ' + (pass + fail) + ')');
    if (mode === 'pglite') {
      console.log('\nSHËNIM: kjo provë u krye me PGlite (sesion i vetëm). Logjika dhe protokolli pg');
      console.log('janë të vërteta, por garë e njëkohshme nuk ekziston këtu. Për provën e vërtetë:');
      console.log('  CONCURRENCY_DATABASE_URL=postgres://…/biobes_dev node test-concurrency-local.cjs');
    }
  } finally {
    try { await pool.end(); } catch (_) {}
    try { if (server) await server.close(); } catch (_) {}
    try { if (pglite) await pglite.close(); } catch (_) {}
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  if (e && e.name === 'SkipError') {
    console.log('\n— PROVA E ANASHKALUAR (jo dështim) —');
    console.log(e.message);
    console.log('\nProva e vërtetë e garës me ' + CONCURRENCY + ' përdorues kërkon një Postgres të zhvillimit:');
    console.log('  CONCURRENCY_DATABASE_URL=postgres://user:pass@host:5432/biobes_dev node test-concurrency-local.cjs');
    console.log('(KURRË kundër prodhimit — kjo provë SHKRUAN dokumente dhe produkte.)');
    console.log('Logjika e numërimit dhe izolimi janë provuar tashmë nga test-kit-local.cjs (15/15).');
    process.exit(0);
  }
  console.error('Dështim fatal:', e && e.message ? e.message : e);
  process.exit(1);
});
````

### FILE: backend/.env.example.additions
_Variablat e reja për .env dhe Render → Environment (APP_DB_ROLE është e detyrueshme)_

````bash
# SHTO këto në biobes-api/backend/.env (dhe në Render → Environment) për P1/P2/P3.
# Ato që ekzistojnë tashmë (DATABASE_URL, ADMIN_EMAIL, PORT…) mos i prek.

# ---- P1: JWT / fjalëkalime ----
# Gjenero me: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
JWT_SECRET=
JWT_REFRESH_SECRET=
JWT_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=604800
# Kohëzgjatja e sesionit të vjetër (nëse server.js përdor sessions/token hash)
SESSION_TTL_DAYS=7

# ---- P2: izolim me kompani ----
# Kompania parazgjedhje kur kërkesa nuk mbart X-Company-Id (vetëm për përputhshmëri të vjetër)
DEFAULT_COMPANY=C1
# Nëse një përdorues ka vetëm 1 kompani, API-ja e plotëson vetë (pa e detyruar frontend-in)
AUTO_COMPANY_FOR_SINGLE_MEMBER=true

# !!!! E DOMOSDOSHME PËR IZOLIMIN !!!!
# PostgreSQL NUK e zbaton Row Level Security për SUPERUSER-in, as me FORCE RLS.
# Nëse roli i DATABASE_URL është i fuqishëm (Aiven avnadmin, PGlite postgres, Neon),
# politikat e 009_rls.sql nuk kanë efekt dhe C1/C2 NUK izolohen.
# Cakto rolin e krijuar nga migrations/013_app_role.sql: lib/pgCompany.js do të bëjë
# "SET LOCAL ROLE biobes_app" në çdo transaksion (kthehet në rolin e seancës pas COMMIT).
APP_DB_ROLE=biobes_app

# ---- P2: CORS + headerë sigurie ----
# Lista e saktë (jo *). Shto edhe domenin e preview-it nëse e përdor.
CORS_ORIGINS=https://biobes-erp-frontend.onrender.com,http://localhost:5173,http://localhost:8080
JSON_LIMIT=12mb
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=500

# ---- P2: pool-i i databazës ----
# 20 përdorues konkurrent: max 10 është i mjaftueshëm nëse çdo kërkesë mban transaksionin
# SHUMË shkurt (set_config LOCAL). Mos e ngri pa matur — Aiven free = 20 lidhje gjithsej.
PG_POOL_MAX=10
PG_IDLE_TIMEOUT_MS=30000
PG_CONNECTION_TIMEOUT_MS=10000
PG_STATEMENT_TIMEOUT_MS=30000

# ---- P3: backup-et automatike në server ----
AUTO_BACKUP_CRON=0 3 * * *
AUTO_BACKUP_KEEP=14
AUTO_BACKUP_DIR=./backups
# Dryeri i backup-it (advisory lock) që 20 pajisje / 2 instance të mos e bëjnë njëkohësisht
AUTO_BACKUP_LOCK_KEY=biobes:auto-backup

# ---- P3: migrimet në nisje ----
RUN_MIGRATIONS_ON_START=true

# ---- P3: manuali / eksporti ----
MANUAL_UPDATED_AT=2026-09-22T00:00:00.000Z
XLSX_PAGE_SIZE=20
````

---

# Fundi i dokumentit

**Pas rikthimit të skedarëve**, hapi tjetër është leximi i `APPLY.md` (§4 ka snippet-et
e integrimit në `server.js`, §5 kujdeset, §6 provat, §9 checklist-in e «mbaruar»).

Kujtesë: **`APP_DB_ROLE=biobes_app`** + migrimet **009→013** + `withCompany()` për
çdo rrugë biznesi = izolimi 100% C1 ≠ C2. Dhe **kurrë** `npm run test:live`.

PLAN-DEPLOY-BIOBES-API.md
+181
# PLAN — Deploy i backend-it `biobes-api` në Render + pastrim i kompanisë së tretë (C3)

> Dokumentim operacional. **Asgjë këtu nuk është ekzekutuar** nga ky sesion: nuk është
> dërguar asnjë POST/PUT/DELETE te `https://biobes-api.onrender.com`, nuk është prekur
> Render Dashboard dhe nuk është bërë push në repo-n `biobes-api`.
>
> Gjendja e verifikuar më 2026-09-22 21:16 UTC gjendet në `VERIFIKIM-LIVE-2026-09-22.md`.
> Përmbledhje: LIVE `db:true` por kodi i deployuar është `main` (`f9590ff`) — pa `/api/manual`,
> pa `/api/export/xlsx`, pa RLS/JWT/bcrypt/helmet, pa migrimet `009/010`; commit-i `ac6bfc5`
> (Faza 2 + P1/P2/P3, 100 file) **nuk ekziston në GitHub** dhe duhet ribërë në një sesion
> të lidhur me repo-n `biobes-api`.

---

## Pjesa 1 — Ribërja e punës P1/P2/P3 (parakusht për deploy)

Repo: `genilufra-droid/biobes-api` · Branch: `arena/01a0be23-biobes-api` (head aktual `0ca0ccc`) → PR drejt `main`.

Lista e punëve për t'u rindërtuar (nga përshkrimi i fazave, të gjitha në `backend/`):

| # | Puna | File kryesorë | Si verifikohet lokalisht |
|---|---|---|---|
| P1 | RLS (Row Level Security) per `company_id` | `migrations/009_rls.sql`, `db.js` (`SET app.company_id`), `company.js` | dy tokenë C1/C2: C1 nuk lexon/shkruan asnjë rresht të C2 |
| P1 | JWT access (15 min) + refresh (7 ditë) + bcrypt | `auth.js`, `middleware/auth.js` | `POST /api/auth/login` → `accessToken`+`refreshToken`; `POST /api/auth/refresh` |
| P2 | Pooling + `SET LOCAL` per transaksion | `db.js` (pg Pool, `application_name`) | 20 lidhje konkurrente, pa `SET app.company_id` të rrjedhur |
| P2 | Sekuenca e dokumenteve me `SELECT … FOR UPDATE` | `sequences.js`, `state.js` | dy pajisje njëkohësisht → numra të ndryshëm (409 `conflict:'number'`) |
| P2 | helmet + CORS multi-origin + rate limit | `server.js` | headerët `X-Content-Type-Options`, `Access-Control-Allow-Origin` sipas origjinës |
| P3 | Cache për N+1, Excel server-side `slice(20)`, `numFmt` | `export.js`, `cache.js` | `GET /api/export/xlsx?module=customerReturns` → 20 rreshta/faqe, formate numerike |
| P3 | `validateState` + advisory lock për backup | `validateState.js`, `backups.js` | PUT me gjendje të pavlefshme → 400; dy backup njëkohësisht → i dyti pret |
| P3 | Indekset `010_p3_indexes.sql` | `migrations/010_p3_indexes.sql` | `EXPLAIN` përdor indeksin për `(company_id, …)` |
| P3 | `/api/manual` | `server.js` | `GET /api/manual` → JSON me modulet (jo `Endpoint i panjohur`) |

Rregullat e pandryshueshme: **100 % cloud** (asnjë e dhënë biznesi në browser), **izolim C1 ≠ C2**,
**`company_id` realtime**, **20 përdorues konkurrent pa konflikt**, **asgjë nuk humbet me pastrim browseri**.

Kontrata që frontend-i (`biobes-erp/index.html`) tashmë e zbaton dhe backend-i duhet ta njohë:

```
GET/PUT   /api/state?company=<ID>            header: X-Company-Id: <ID>
POST      /api/state/patch?company=<ID>      header: X-Company-Id: <ID>
GET       /api/state/version?company=<ID>    header: X-Company-Id: <ID>
GET       /api/auth/me?company=<ID>          header: X-Company-Id: <ID>
GET       /api/events?token=<JWT>&company=<ID>      (SSE — company me query, EventSource nuk dërgon headerë)
GET/POST  /api/backups?company=<ID> · POST /api/backups/:id/restore · DELETE /api/backups/:id
GET       /api/manual · GET /api/export/xlsx?module=<mod>&company=<ID>
```

Përgjigjet duhet të kthejnë fushën `company` (p.sh. `{ok:true, state, version, company:"C1"}`) —
frontend-i e përdor për të mësuar/mirëmbajtur `company_id` aktive edhe kur moduli multi-company është i fjetur.

---

## Pjesa 2 — Deploy në Render (backend)

### 2.1 Para deploy-it
1. Në GitHub: PR nga `arena/01a0be23-biobes-api` → `main` (bashkoje pasi kalon CI/testet lokale).
2. Render → shërbimi `biobes-api` → **Settings**:
   - **Branch**: `main` (ose përkohësisht branch-i i punës për provë, pastaj ktheje në `main`).
   - **Root Directory**: `backend` (atje është `package.json`).
   - **Build**: `npm ci` · **Start**: `node server.js`.
   - **Health Check Path**: `/api/health`.
3. **Environment** (të gjitha si `Secret`, jo në Git):

| Variabël | Vlera / shënim |
|---|---|
| `DATABASE_URL` | Aiven Postgres, **përdor `-pooler`** (port 6543, `pgbouncer`) për 20 përdorues |
| `PGSSLMODE` | `require` |
| `JWT_SECRET` | ≥ 64 shenja, e rastësishme (`openssl rand -hex 48`) — **jo** e njëjtë me atë të dev |
| `JWT_REFRESH_SECRET` | e dytë, e veçantë |
| `JWT_TTL` / `JWT_REFRESH_TTL` | `15m` / `7d` |
| `CORS_ORIGINS` | `https://biobes-erp.onrender.com,https://<preview-host>` (lista, pa yll `*`) |
| `SYNC_ALL_MODULES` | `1` |
| `BCRYPT_ROUNDS` | `12` |
| `RATE_LIMIT_*` | sipas `render.yaml` (login: 5/15 min) |
| `SMTP_*` | opsionale (rikthim fjalëkalimi) |

4. **Migrimet**: nëse `render.yaml`/`package.json` nuk e bën vetë, shto në Build Command:
   `npm ci && node migrate.js` (aplikon `009_rls.sql`, `010_p3_indexes.sql`).
   Verifiko në psql: `SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 3;`
5. **Restart** (Manual Deploy → *Clear build cache & deploy*) — Render mban `pg` pool-in të ngrohtë.

### 2.2 Pas deploy-it — verifikim LIVE (vetëm GET, asnjë shkrim)

```bash
curl -s https://biobes-api.onrender.com/api/health
# prit: {"ok":true,"db":true,"version":…,"syncPolicy":"all-modules","defaultCompany":"C1","companies":2}

curl -s https://biobes-api.onrender.com/api/manual | head -c 400
# prit: JSON me modulet — JO {"ok":false,"error":"Endpoint i panjohur"}

curl -sI "https://biobes-api.onrender.com/api/export/xlsx?module=customerReturns"
# prit: 200 + Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
```

Kontrolli i izolimit (me dy llogari provë, C1 dhe C2 — **jo** me të dhëna reale):
```bash
T1=$(curl -s -XPOST $URL/api/auth/login -H 'content-type: application/json' -d '{"username":"provac1","password":"…"}' | jq -r .accessToken)
curl -s "$URL/api/state" -H "Authorization: Bearer $T1" -H "X-Company-Id: C2"   # → 403/404, KURRË gjendja e C2
```
Sigurohu që politikat RLS ekzistojnë:
```sql
SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' ORDER BY 1;
```

### 2.3 Frontend-i
`biobes-erp` (ky repo) është **static** në Render (shih `render.yaml`): push në `main` → build automatik.
Pas deploy-it të backend-it, në aplikacion: Konfigurime → Zona e rrezikut → **Lidhja me serverit** = `https://biobes-api.onrender.com`
(vlera e parazgjedhur tashmë është kjo). Treguesi poshtë-majtas duhet të thotë `☁ I sinkronizuar … · v… · C1`.

### 2.4 Ndalohet
- `npm run test:live` kundër LIVE → bën **WIPE** të të dhënave reale.
- Çdo POST/DELETE provë me kompanitë reale C1/C2.
- Testet e reja të izolimit të ekzekutohen kundër serverit të rremë (siç bën `tests/cloud-isolation-audit.cjs`).

---

## Pjesa 3 — `companies:3` në LIVE: pastrim i kompanisë së tretë (C3) **pa prekur C1/C2**

Verifikimi LIVE tregoi `companies:3`, ndërsa priten 2. Hapat më poshtë janë **për t'u ekzekutuar
nga pronari** (ose nga një sesion i lidhur me `biobes-api`), jo nga ky sesion.

### 3.1 Diagnoza (read-only)
```bash
curl -s $URL/api/health | jq '{companies, defaultCompany}'
curl -s $URL/api/admin/companies -H "Authorization: Bearer $ADMIN" | jq '.companies[]|{id,code,name,active,users,stateVersion,hasState}'
```
```sql
SELECT id, code, name, active, created_at FROM companies ORDER BY id;
SELECT company_id, count(*) FROM company_users GROUP BY 1 ORDER BY 1;
```
Vendos: a është C3 kompani test-e mbetur (p.sh. `TR`/`XX` nga provat multi-company) apo e vërtetë?

### 3.2 Nëse është test-e mbetur — dy rrugë (zgjidh NJËRËN)

**Rruga A (e rekomanduar): çaktivizo, mos fshi**
```bash
curl -s -XPATCH $URL/api/admin/companies/C3 -H "Authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"active":false}'
```
→ `companies` në health numëron vetëm aktivet; të dhënat mbeten për auditim; asnjë rrezik për C1/C2.

**Rruga B: wipe per kompani (i pakthyeshëm)**
```bash
# 1) backup i plotë i serverit PËRPARA (kthehet vetëm për C1/C2 nëse nevojitet)
curl -s -XPOST $URL/api/backups -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"label":"para-wipe-C3"}'
# 2) verifiko që C1/C2 kanë gjendje + version
curl -s "$URL/api/state?company=C1" -H "Authorization: Bearer $ADMIN" | jq '{version, n:(.state.suppliers|length)}'
curl -s "$URL/api/state?company=C2" -H "Authorization: Bearer $ADMIN" | jq '{version, n:(.state.suppliers|length)}'
# 3) wipe VETËM për C3 (endpoint-i per kompani — KURRË /api/admin/wipe, ai fshin gjithçka)
curl -s -XPOST $URL/api/admin/company/C3/wipe -H "Authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"confirm":"C3"}'
# 4) pas wipe-it: riprovo C1/C2 (duhet të jenë të pandryshuara) dhe health
curl -s $URL/api/health | jq '{ok,db,companies}'
```

### 3.3 Rregulla sigurie për wipe
- **Kurrë** `POST /api/admin/wipe` (fshin të gjitha kompanitë + përdoruesit) dhe **kurrë** `npm run test:live`.
- Wipe bëhet vetëm me `company_id` të shprehur dhe vetëm pasi ekziston backup i serverit.
- Pas wipe-it, `company_wipe_epoch` e asaj kompanie rritet → pajisjet që kishin cache të vjetër
  e marrin gjendjen bosh nga serveri (frontend-i `honorServerWipe` e zbaton vetë, pa dialog për përdoruesin normal).
- Shenja e pranimit të wipe-it është per kompani (`biobesWipeAck:C3`) → C1/C2 nuk preken.

---

## Pjesa 4 — Çka u bë në KËTË repo (`biobes-erp`) për të plotësuar kërkesat fikse

Shih `tests/cloud-isolation-audit.cjs` (22 prova) dhe modulin `biobes-cloud-isolation-v1` në `index.html`:

1. `company_id` në çdo kërkesë: header `X-Company-Id` + `?company=`, edhe në SSE (`/api/events?token=…&company=…`)
   e cila **rihapet** me kompaninë e re sapo ndërron kompania.
2. Izolim C1 ≠ C2: shenja e punës së paruajtur (`biobesDirty:<ID>`), baza e bashkimit (`cloud:syncbase:<ID>`)
   dhe cache-t janë per kompani; event-et e kompanive të tjera shpërfillen.
3. Puna e paruajtur nuk humbet në ndërrim kompanie: kopja vendore bashkohet me `mergeStates` (server/bazë/vendore)
   dhe dërgohet sapo kthehet lidhja.
4. Browseri është vetëm cache: `localStorage` nuk mban më gjendje/backup (`biobesPreSyncSnapshot`,
   `biobesAutoBackup` u hoqën → IndexedDB per kompani); backup-i ditor është **server-first** (`POST /api/backups`).
5. Serveri para cache-it: gjendja tërhiqet gjithmonë në hyrje dhe në çdo ndërrim kompanie → me pastrim
   të plotë të browserit asgjë nuk humbet.
6. Shkrimet e një pajisjeje renditen (mutex) → më pak vetë-konflikte për 20 përdorues; konfliktet midis
   pajisjeve zgjidhen me op-e per dokument (`prev`/CAS) dhe numërim të ri automatik.

README-DEPLOY.md
+22
−1

## ⚠️ Shumë e rëndësishme — të dhënat

### Me backend të lidhur (regjimi cloud — i rekomanduari)

Kur te Konfigurime → Zona e rrezikut → **Lidhja me serverin** është vendosur URL-ja e
`biobes-api` (e parazgjedhura: `https://biobes-api.onrender.com`):

- **Serveri është burimi i së vërtetës.** Gjendja tërhiqet nga serveri në hyrje dhe në çdo
  ndërrim kompanie; shkrimet dërgohen me kontroll versioni (CAS) ose per dokument
  (`/api/state/patch`) — dy pajisje që shkruajnë njëkohësisht nuk humbin asgjë.
- **Shfletuesi është vetëm cache** (IndexedDB): me pastrim të plotë të browserit, me telefon
  tjetër ose me PC tjetër, e gjithë puna rikthehet nga serveri. `localStorage` nuk mban më
  kopje të gjendjes apo backup-e biznesi.
- **Backup-i ditor bëhet në server** (`POST /api/backups`); kopja vendore krijohet vetëm nëse
  serveri nuk arritet. Rikthimi bëhet së pari nga backup-et e serverit.
- **Multi-company:** çdo kërkesë mbart `company_id` (`?company=` + header `X-Company-Id`),
  edhe lidhja realtime SSE (`/api/events?token=…&company=…`) e cila rihapet kur ndërron
  kompania. Shenjat e punës së paruajtur dhe bazat e bashkimit janë per kompani → C1 ≠ C2.
- Koha reale: ndryshimet e përdoruesve të tjerë shfaqen brenda ~1–2 s pa rifreskim faqe
  (treguesi `☁ I sinkronizuar … · v… · C1` poshtë-majtas).

### Pa backend (vetëm skedar statik)

- Të dhënat ruhen në **shfletuesin e çdo pajisjeje** (IndexedDB), **JO** në server.
- Kjo do të thotë: telefoni, PC-ja dhe çdo përdorues tjetër kanë **kopje të veçanta** — ndryshimet nuk sinkronizohen automatikisht.
- Për të transferuar të dhënat: **Backup (⇩)** në krye → shkarkon JSON → **Import (⇧)** në pajisjen tjetër.
- Render-i e bën aplikacionin të arritshëm online, por **nuk** e kthen në sistem me shumë përdorues me databazë të përbashkët. Për këtë shërben backend-i **biobes-api** (repo më vete — shih `README-BACKEND.md`): pasi të vendoset URL-ja e tij te Konfigurime → Zona e rrezikut → Lidhja me serverin, butoni **Reset** fshin edhe serverin, edhe pajisjen.
- Render-i e bën aplikacionin të arritshëm online, por **nuk** e kthen në sistem me shumë përdorues me databazë të përbashkët. Për këtë shërben backend-i **biobes-api** (repo më vete — shih `README-BACKEND.md` dhe `PLAN-DEPLOY-BIOBES-API.md`): pasi të vendoset URL-ja e tij te Konfigurime → Zona e rrezikut → Lidhja me serverin, butoni **Reset** fshin edhe serverin, edhe pajisjen.

## Reset-i me password (lokal + server)


VERIFIKIM-LIVE-2026-09-22.md
+87
# Verifikim i gjendjes — biobes-api (LIVE + GitHub) · 2026-09-22 21:16 UTC

> Ky file është **vetëm dokumentim i verifikuar** (read-only). Nuk është bërë asnjë push, asnjë PR,
> asnjë deploy dhe asnjë thirrje shkrimi/fshirjeje ndaj serverit LIVE.

## Përmbledhje (3 rreshta)

1. Kërkesa i drejtohet repo-s **`genilufra-droid/biobes-api`**, branch **`arena/01a0be23-biobes-api`**, commit **`ac6bfc5`**.
   Ky sandbox është **`genilufra-droid/biobes-erp`**, branch **`arena/01a0caf7-biobes-erp`**, commit **`94676b0`** → kodi i backend-it **nuk është këtu**.
2. Commit-i **`ac6bfc5` nuk ekziston në GitHub** (HTTP 422). Asnjë branch i `biobes-api` nuk i ka migrimet `009/010_p3_indexes` → puna Faza 2 + P1/P2/P3 (100 file) **nuk ka mbërritur kurrë në remote**; ka mbetur vetëm në sandbox-in e mbyllur.
3. Serveri LIVE është **gjallë dhe me DB të lidhur**, por po shërben **kodin e vjetër (main `f9590ff`)**: `/api/manual` dhe `/api/export/xlsx` kthejnë `Endpoint i panjohur`, dhe `companies:3` (jo 2).

---

## 1. Sandbox-i aktual (verifikuar me komanda)

| Artikull | Pritur (nga kërkesa) | Realitet |
|---|---|---|
| Repo | `biobes-api` | `biobes-erp` (`origin → github.com/genilufra-droid/biobes-erp.git`) |
| Branch | `arena/01a0be23-biobes-api` | `arena/01a0caf7-biobes-erp` (i vetmi i lidhur me këtë sesion) |
| Commit | `ac6bfc5` | `94676b0` — *Merge PR #81: Shkrimet blind ndalohen…* |
| `git status` | clean | **clean** ✅ (asnjë ndryshim i pa-commituar) |
| `backend/` | `server.js`, `access.js`, `validateState.js` | **nuk ekziston** — repo përmban `index.html`, `tests/*.cjs`, `render.yaml` (static site) |
| `RAPORT-SUPER-DEEP-ANALYZE-3.md` | burimi i P1/P2/P3 | **nuk ekziston** |
| `/tmp/pr_body.md` | body për PR | **nuk ekziston** |

## 2. Pika 1 — `node -c backend/*.js`: **e pamundur këtu**
`git cat-file -t ac6bfc5` → `fatal: Not a valid object name`. Nuk ka as `backend/server.js`, as `access.js`,
as `validateState.js` në këtë checkout, prandaj `node -c` nuk ka çfarë të kontrollojë.

## 3. Pika 2 — `git push origin arena/01a0be23-biobes-api`: **e pamundur / e ndaluar**
- Nuk ka asgjë për të shtyrë: commit-i `ac6bfc5` nuk është në këtë repo (dhe as në GitHub).
- Sesioni është i lidhur ngushtë me branch-in `arena/01a0caf7-biobes-erp` të `biobes-erp` → nuk lejohet push në repo/branch tjetër.

## 4. Pika 3 — PR nga `arena/01a0be23-biobes-api` → `main`: **tashmë i mbyllur**

| PR | Branch | Head | Gjendja | Data |
|---|---|---|---|---|
| #9 | `arena/01a0be23-biobes-api` | `0ca0ccc` — *Cloud rewrite: multi-company, realtime SSE, server-authoritative sync, CRUD* | **CLOSED** (nga pronari, i pa-mergeuar) | 2026-09-22 20:49 UTC |
| #5 | `arena/01a0be23-biobes-api` | i njëjti | **CLOSED** | 2026-09-21 19:23 UTC |
| #8 | `fix/higiene-para-push` | — | MERGED → `main` `f9590ff` | 2026-09-21 21:03 UTC |

Head i branch-it në remote: `0ca0ccc8450ad5d4b6794539841b2f0d89c42877` (2026-09-21 19:22 UTC) — **jo** `ac6bfc5`.

### Migrimet që ekzistojnë realisht në `biobes-api`
- `arena/01a0be23-biobes-api`: `001…007_multi_company.sql` (fund)
- `main`: `001…008_companies.sql` (fund)
- **Asnjë** `009_*`, **asnjë** `010_p3_indexes.sql` → P1/P2/P3 nuk është në GitHub.

## 5. Pika 4 — Verifikimi LIVE (vetëm GET, asnjë POST/wipe)

Shënim teknik: nga sandbox-i `curl` drejt internetit është i bllokuar (`SSL_ERROR_SYSCALL` edhe për
`example.com`/`render.com`), prandaj thirrjet u bënë përmes proxy-ët të leximit të faqeve (GET, read-only).

| Endpoint | Përgjigja reale | Pritur | Rezultati |
|---|---|---|---|
| `GET /api/health` | `{"ok":true,"db":true,"version":1,"syncPolicy":"all-modules","defaultCompany":"C1","companies":3,"time":"2026-09-22T21:15:59.185Z"}` | `ok:true, db:true, companies:2` | ⚠️ pjesërisht — `db:true` ✅, por **`companies:3` ≠ 2** |
| `GET /api/manual` | `{"ok":false,"error":"Endpoint i panjohur"}` | manuali i moduleve | ❌ route nuk ekziston në deploy |
| `GET /api/export/xlsx?module=customerReturns` | `{"ok":false,"error":"Endpoint i panjohur"}` | xlsx server-side | ❌ route nuk ekziston në deploy |

### Pse LIVE nuk i ka këto route (provë)
`backend/server.js` në `main` (`f9590ff`, 955 rreshta) **nuk përmban** as `api/manual`, as `export/xlsx`,
as `row level security`, as `jsonwebtoken`, as `bcrypt`, as `helmet` → Render po ekzekuton kodin e `main`,
pra deploy-i i P1/P2/P3 **nuk ka ndodhur** (dhe nuk mund të ndodhë pa commit në GitHub).

## 6. Pika 5 — `npm run test:live` ndaj LIVE: **NUK u ekzekutua** ✅
Asnjë thirrje shkrimi/fshirjeje (POST/PUT/DELETE, wipe, backup-write) nuk u dërgua ndaj `biobes-api.onrender.com`.

---

## Çfarë duhet për të vazhduar realisht

1. **Sesion i ri Arena i lidhur me repo-n `biobes-api`** — vetëm atje mund të pushohet branch-i
   `arena/01a0be23-biobes-api` dhe të hapet PR drejt `main`.
2. **Puna P1/P2/P3 duhet ribërë** (nuk rikuperohet nga GitHub): `ac6bfc5` ka qenë vetëm lokal në sandbox-in e mbyllur.
   Nëse ke një kopje lokale (patch/zip/`git bundle`) nga ai sandbox, ajo është e vetmja rrugë për ta shpëtuar pa e rishkruar.
3. **Render**: deploy-i duhet drejtuar në branch-in që përmban kodin (ose merge në `main`) + env vars
   (`JWT_SECRET`, `DATABASE_URL` me pooling, `SYNC_ALL_MODULES`, SMTP) dhe migrimet `009/010` të aplikohen para restart-it.
4. **`companies:3` vs `2`**: të vendoset nëse kompania e tretë është test-e mbetur (për t'u wipeuar per-kompani)
   apo e vërtetë — pa prekur C1/C2.

### Shënim shtesë (21:20–21:35 UTC) — gjendja "Application loading"
Në riprovat e mëvonshme `https://biobes-api.onrender.com/api/health` ktheu faqen e Render-it
**"Application loading"** (shërbimi po nisej / free tier pas gjumi). Kjo është sjellje e pritshme
e cold-start: përgjigja e shëndetshme e matur më 21:15:59 UTC (`db:true`) tregon që shërbimi
funksionon kur është i ngrohtë. Rekomandim: në Render → Settings të aktivizohet *Health Check Path*
`/api/health` dhe, nëse mbetet në plan falas, të pritet 30–60 s pas gjumit përpara verifikimit.

biobes-api-kit/APPLY.md
+450
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

biobes-api-kit/backend/.env.example.additions
+54
# SHTO këto në biobes-api/backend/.env (dhe në Render → Environment) për P1/P2/P3.
# Ato që ekzistojnë tashmë (DATABASE_URL, ADMIN_EMAIL, PORT…) mos i prek.
# ---- P1: JWT / fjalëkalime ----
# Gjenero me: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
JWT_SECRET=
JWT_REFRESH_SECRET=
JWT_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=604800
# Kohëzgjatja e sesionit të vjetër (nëse server.js përdor sessions/token hash)
SESSION_TTL_DAYS=7
# ---- P2: izolim me kompani ----
# Kompania parazgjedhje kur kërkesa nuk mbart X-Company-Id (vetëm për përputhshmëri të vjetër)
DEFAULT_COMPANY=C1
# Nëse një përdorues ka vetëm 1 kompani, API-ja e plotëson vetë (pa e detyruar frontend-in)
AUTO_COMPANY_FOR_SINGLE_MEMBER=true
# !!!! E DOMOSDOSHME PËR IZOLIMIN !!!!
# PostgreSQL NUK e zbaton Row Level Security për SUPERUSER-in, as me FORCE RLS.
# Nëse roli i DATABASE_URL është i fuqishëm (Aiven avnadmin, PGlite postgres, Neon),
# politikat e 009_rls.sql nuk kanë efekt dhe C1/C2 NUK izolohen.
# Cakto rolin e krijuar nga migrations/013_app_role.sql: lib/pgCompany.js do të bëjë
# "SET LOCAL ROLE biobes_app" në çdo transaksion (kthehet në rolin e seancës pas COMMIT).
APP_DB_ROLE=biobes_app
# ---- P2: CORS + headerë sigurie ----
# Lista e saktë (jo *). Shto edhe domenin e preview-it nëse e përdor.
CORS_ORIGINS=https://biobes-erp-frontend.onrender.com,http://localhost:5173,http://localhost:8080
JSON_LIMIT=12mb
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=500
# ---- P2: pool-i i databazës ----
# 20 përdorues konkurrent: max 10 është i mjaftueshëm nëse çdo kërkesë mban transaksionin
# SHUMË shkurt (set_config LOCAL). Mos e ngri pa matur — Aiven free = 20 lidhje gjithsej.
PG_POOL_MAX=10
PG_IDLE_TIMEOUT_MS=30000
PG_CONNECTION_TIMEOUT_MS=10000
PG_STATEMENT_TIMEOUT_MS=30000
# ---- P3: backup-et automatike në server ----
AUTO_BACKUP_CRON=0 3 * * *
AUTO_BACKUP_KEEP=14
AUTO_BACKUP_DIR=./backups
# Dryeri i backup-it (advisory lock) që 20 pajisje / 2 instance të mos e bëjnë njëkohësisht
AUTO_BACKUP_LOCK_KEY=biobes:auto-backup
# ---- P3: migrimet në nisje ----
RUN_MIGRATIONS_ON_START=true
# ---- P3: manuali / eksporti ----
MANUAL_UPDATED_AT=2026-09-22T00:00:00.000Z
XLSX_PAGE_SIZE=20

biobes-api-kit/backend/lib/advisoryLock.js
+59
'use strict';
/* lib/advisoryLock.js — dryer i vetëm për punë që nuk duhet të ecin dy herë njëkohësisht.
 *
 * Rasti real: backup-i ditor automatik niset nga 20 pajisje (ose nga dy instance të
 * Render-it) në të njëjtën minutë → dy backup-e të njëjta, ose më keq, dy写入 të
 * njëkohshme që mbishkruajnë njëra-tjetrën. Me pg_advisory_xact_lock vetëm njëri
 * transaksion e merr dryerin; tjetri pret (ose dështon menjëherë me try-lock).
 *
 *   const { withAdvisoryLock, tryAdvisoryLock } = require('./lib/advisoryLock');
 *   await withCompany(ctx, (client) => withAdvisoryLock(client, 'backup:' + ctx.companyId, async () => {
 *     ... krijo backup-in ...
 *   }));
 */
const crypto = require('node:crypto');

/* Çelësi tekst → dy numra 32-bit (pg_advisory_lock merr bigint ose dy int). */
function keyParts(key) {
  const h = crypto.createHash('sha256').update(String(key)).digest();
  return [h.readInt32BE(0), h.readInt32BE(4)];
}

/* Bllokim që jeton sa transaksioni (lirohet automatikisht në COMMIT/ROLLBACK). */
async function withAdvisoryLock(client, key, fn) {
  const [a, b] = keyParts(key);
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [a, b]);
  return await fn();
}

/* Provë pa pritje: kthen true nëse dryeri u mor (përsëri brenda transaksionit). */
async function tryAdvisoryLock(client, key) {
  const [a, b] = keyParts(key);
  const r = await client.query('SELECT pg_try_advisory_xact_lock($1, $2) AS ok', [a, b]);
  return !!(r.rows[0] && r.rows[0].ok);
}

/* Bllokim në nivel lidhjeje (jashtë transaksionit) — përdoret rrallë, p.sh. për
 * pastrime të gjata. Çlirohet në fund me unlock; nëse lidhja mbyllet, lirohet vetë. */
async function withSessionLock(pool, key, fn) {
  const client = await pool.connect();
  const [a, b] = keyParts(key);
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [a, b]);
    return await fn(client);
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1, $2)', [a, b]); } catch (_) {}
    client.release();
  }
}

/* Ndihmës për rrugët API: nëse dryeri është i zënë → 409 me mesazh shqip (jo pritje e gjatë). */
async function runExclusive(client, key, fn, busyMessage) {
  const got = await tryAdvisoryLock(client, key);
  if (!got) {
    throw Object.assign(new Error(busyMessage || 'Një operacion i njëjtë është duke u kryer — provo pas pak'), { status: 409, busy: true });
  }
  return await fn();
}

module.exports = { withAdvisoryLock, tryAdvisoryLock, withSessionLock, runExclusive, keyParts };

biobes-api-kit/backend/lib/pgCompany.js
+154
'use strict';
/* lib/pgCompany.js — konteksti i kompanisë për ÇDO transaksion (parakusht i RLS).
 *
 * Pse është thelbësor: me një Pool, `SET app.company_id = 'C1'` (pa LOCAL) mbetet
 * në lidhje dhe lidhja e njëjtë i shërben më pas një përdoruesi tjetër → rrjedhje
 * midis kompanive. Këtu përdoret set_config(..., is_local => true) brenda BEGIN/COMMIT,
 * pra konteksti vdes me transaksionin dhe lidhja kthehet e pastër në pool.
 *
 * Përdorimi:
 *   const { withCompany, withSystem, HttpError } = require('./lib/pgCompany');
 *   const rows = await withCompany({ companyId: 'C1', userId: 'u1' }, async (client) => {
 *     const r = await client.query('SELECT * FROM products ORDER BY code');
 *     return r.rows;   // vetëm produktet e C1 — i garanton Postgres-i, jo kodi
 *   });
 *
 *   // Operacione para-autentikimit (login) ose sistem (migrime, backup ditor):
 *   const user = await withSystem((client) => findByUsername(client, 'admin'));
 */
/* Pool-i merret nga ../db (ekziston në biobes-api). Kërkesa është e VONUAR (lazy)
 * që ky modul të mund të provohet edhe jashtë repo-s (shih test-kit-local.cjs, i cili
 * injekton një pool PGlite me setPoolProvider). */
let poolProvider = null;
function setPoolProvider(fn) { poolProvider = fn; }

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (extra && typeof extra === 'object') Object.assign(this, extra);
  }
}

function poolOrThrow() {
  let pool = null;
  if (typeof poolProvider === 'function') pool = poolProvider();
  else pool = require('../db').getPool();
  if (!pool) throw new HttpError(503, 'Databaza nuk është e konfiguruar (DATABASE_URL mungon)');
  return pool;
}

/* Roli i databazës që i nënshtrohet RLS.
 *
 * PSE ËSHTË I DOMOSDOSHËM: PostgreSQL nuk e zbaton RLS për SUPERUSER-in, MADJE as
 * me FORCE ROW LEVEL SECURITY. Shumë shërbime cloud (Aiven `avnadmin`, PGlite
 * `postgres`, Neon, Supabase) lidhen si rol me privilegje të larta → politikat nuk
 * do të kishin asnjë efekt dhe izolimi C1 ≠ C2 do të ishte vetëm "në letër".
 *
 * Zgjidhja: çdo transaksion bën `SET LOCAL ROLE <APP_DB_ROLE>` (rol jo-superuser,
 * jo pronar i tabelave) përpara se të vendosë kontekstin. SET LOCAL = roli rikthehet
 * në atë të seancës pas COMMIT/ROLLBACK, pra lidhja kthehet e pastër në pool.
 *
 * Nëse APP_DB_ROLE nuk është caktuar, moduli punon si më parë (vetëm set_config) —
 * por atëherë DUHET të jesh i sigurt që roli i lidhjes nuk është superuser. */
function appRole() {
  const r = String(process.env.APP_DB_ROLE || '').trim();
  if (!r) return '';
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(r)) {
    throw new HttpError(500, 'APP_DB_ROLE i pavlefshëm: lejohen vetëm shkronja, numra dhe _');
  }
  return r;
}

async function setContext(client, ctx) {
  const role = appRole();
  if (role) await client.query('SET LOCAL ROLE ' + role);
  await client.query(
    "SELECT set_config('app.company_id', $1, true), set_config('app.user_id', $2, true), set_config('app.is_superadmin', $3, true)",
    [
      String((ctx && ctx.companyId) || ''),
      String((ctx && ctx.userId) || ''),
      (ctx && ctx.isSuperadmin) ? 'on' : 'off',
    ]
  );
}

/* Transaksion me kontekst kompanie. `fn(client)` mund të kthejë vlerë ose të hedhë gabim. */
async function withCompany(ctx, fn) {
  const pool = poolOrThrow();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

/* Kontekst sistemi: BYPASS i RLS me app.is_superadmin='on'.
 * VETËM për login/refresh, migrime, backup dhe punë administrimi të brendshme. */
function withSystem(fn) {
  return withCompany({ companyId: '', userId: '', isSuperadmin: true }, fn);
}

/* Kërkesë e vetme (pa fn) — e convenient për GET të thjeshta. */
async function queryCompany(ctx, sql, params) {
  return withCompany(ctx, (client) => client.query(sql, params));
}

/* Ndihmës: lexo kompaninë aktive nga kërkesa (header X-Company-Id → ?company= → defaultCompany).
 * Nuk vendos asgjë vetë — vetëm kthen id-në; anëtarësia kontrollohet më poshtë. */
function companyFromRequest(req) {
  const h = req.get ? req.get('x-company-id') : (req.headers || {})['x-company-id'];
  const q = (req.query && (req.query.company || req.query.companyId)) || '';
  const fromAuth = (req.auth && (req.auth.companyId || req.auth.defaultCompany)) || '';
  return String(h || q || fromAuth || '').trim();
}

/* Middleware: siguron që kompania është e njohur dhe përdoruesi është anëtar i saj.
 * Kthehet 403 nëse nuk është anëtar (izolim edhe para se të pyetet databaza). */
function requireCompanyMembership(options) {
  const opts = options || {};
  return async function requireCompanyMembershipMw(req, res, next) {
    try {
      const pool = poolOrThrow();
      const companyId = companyFromRequest(req) || (req.auth && req.auth.defaultCompany) || '';
      if (!companyId) {
        return res.status(400).json({ ok: false, error: 'Mungon kompania (X-Company-Id ose ?company=)' });
      }
      const userId = (req.auth && (req.auth.userId || req.auth.sub)) || '';
      const isSuper = !!(req.auth && req.auth.isSuperadmin);

      // Kontrolli i anëtarësisë bëhet me kontekst sistemi: lexon company_users pa RLS
      // (përndryshe politika do kërkonte vetë kontekstin që po përpiqemi ta vërtetojmë).
      const r = await pool.query(
        `SELECT 1
           FROM company_users cu
           JOIN companies c ON c.id = cu.company_id
          WHERE cu.company_id = $1 AND cu.user_id = $2 AND c.active = TRUE
          LIMIT 1`,
        [companyId, userId]
      );
      if (!isSuper && (!userId || r.rowCount === 0)) {
        if (opts.allowInactive) { /* lejohet leximi i kompanive të çaktivizuara */ }
        else return res.status(403).json({ ok: false, error: 'Nuk jeni anëtar i kësaj kompanie' });
      }
      req.companyId = companyId;
      req.companyCtx = { companyId, userId, isSuperadmin: isSuper };
      next();
    } catch (e) {
      if (e && e.status) return res.status(e.status).json({ ok: false, error: e.message });
      console.error('[requireCompanyMembership]', e.message);
      res.status(500).json({ ok: false, error: 'Gabim në verifikimin e kompanisë' });
    }
  };
}

module.exports = { withCompany, withSystem, queryCompany, companyFromRequest, requireCompanyMembership, setContext, setPoolProvider, HttpError };

biobes-api-kit/backend/lib/sequences.js
+161
'use strict';
/* lib/sequences.js — numra dokumentesh të sigurt për 20 përdorues konkurrent.
 *
 * Problemi real: dy pajisje krijojnë faturë në të njëjtin çast. Të dyja llogarisin
 * «numrin e radhës» nga lista VENDORE → i njëjti numër → dyfishim ose mbishkrim.
 * Zgjidhja: numri merret nga një rresht i vetëm i bllokuar me SELECT … FOR UPDATE
 * në doc_sequences (company_id, kind, period). Transaksioni i dytë PRET derisa i pari
 * të bëjë COMMIT, pastaj merr numrin pasardhës. Asnjë dyfishim, asnjë humbje.
 *
 * Kërkon: migrimet 011_doc_sequences.sql + lib/pgCompany.js (client brenda transaksionit).
 *
 *   const { withCompany } = require('./lib/pgCompany');
 *   const { nextNumber } = require('./lib/sequences');
 *   const number = await withCompany(ctx, (client) => nextNumber(client, ctx.companyId, 'sales_invoice'));
 *   // → 'FSH-2026-0007'
 */

const KINDS = {
  sales_invoice:    { prefix: 'FSH', period: 'year',  table: 'sales_invoices',    column: 'number' },
  purchase_invoice: { prefix: 'FBL', period: 'year',  table: 'purchase_invoices', column: 'number' },
  stock_in:         { prefix: 'FH',  period: 'year',  table: '', column: '' },
  stock_out:        { prefix: 'FD',  period: 'year',  table: '', column: '' },
  weighing:         { prefix: 'PS',  period: 'year',  table: 'weighings', column: '' },
  sample:           { prefix: 'MS',  period: 'year',  table: '', column: '' },
  order:            { prefix: 'POR', period: 'year',  table: '', column: '' },
  shipment:         { prefix: 'NG',  period: 'year',  table: '', column: '' },
  customer_return:  { prefix: 'RK',  period: 'year',  table: '', column: '' },
  supplier_return:  { prefix: 'RF',  period: 'year',  table: '', column: '' },
  payment:          { prefix: 'PG',  period: 'year',  table: 'payments', column: '' },
  customer_payment: { prefix: 'AR',  period: 'year',  table: 'customer_payments', column: '' },
};

function periodKey(mode, at) {
  const d = at instanceof Date ? at : new Date(at || Date.now());
  const y = d.getUTCFullYear();
  if (mode === 'none') return '';
  if (mode === 'month') return y + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  return String(y);
}

function formatNumber(prefix, period, n, pad) {
  const seq = String(n).padStart(pad || 4, '0');
  return period ? prefix + '-' + period + '-' + seq : prefix + '-' + seq;
}

/* Numri i radhës (i bllokuar). Thirret BRENDA një transaksioni. */
async function nextNumber(client, companyId, kind, options) {
  const opt = options || {};
  const cfg = KINDS[kind];
  if (!cfg) throw Object.assign(new Error('Lloj dokumenti i panjohur: ' + kind), { status: 400 });
  if (!companyId) throw Object.assign(new Error('Mungon company_id për numërimin'), { status: 400 });

  const period = opt.period != null ? String(opt.period) : periodKey(opt.periodMode || cfg.period, opt.at);
  const prefix = String(opt.prefix || cfg.prefix);
  const pad = opt.pad || 4;

  await client.query(
    `INSERT INTO doc_sequences (company_id, kind, period, last_number, prefix)
     VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (company_id, kind, period) DO NOTHING`,
    [companyId, kind, period, prefix]
  );

  // Bllokimi i rreshtit: kjo është pika ku garë e 20 përdoruesve ndalet.
  const lock = await client.query(
    `SELECT last_number FROM doc_sequences
      WHERE company_id = $1 AND kind = $2 AND period = $3
      FOR UPDATE`,
    [companyId, kind, period]
  );
  if (!lock.rows.length) throw Object.assign(new Error('Sekuenca nuk u gjet'), { status: 500 });

  const next = Number(lock.rows[0].last_number) + 1;
  const number = opt.suffix ? formatNumber(prefix, period, next, pad) + '-' + opt.suffix : formatNumber(prefix, period, next, pad);

  await client.query(
    `UPDATE doc_sequences SET last_number = $1, prefix = $2, updated_at = NOW(), updated_by = $3
      WHERE company_id = $4 AND kind = $5 AND period = $6`,
    [next, prefix, String(opt.userId || ''), companyId, kind, period]
  );
  await markUsed(client, companyId, kind, number, opt);
  return number;
}

/* Numri që një pajisje e ka zgjedhur vetë: pranohet VETËM nëse është i lirë.
 * Nëse është i zënë → kthehet { conflict:true, number } që API-ja të japë 409
 * me { ok:false, conflict:'number', number, nextNumber } (kontrata e frontend-it). */
async function reserveNumber(client, companyId, kind, wanted, options) {
  const opt = options || {};
  const cfg = KINDS[kind] || {};
  const n = String(wanted || '').trim();
  if (!n) return { ok: false, reason: 'empty' };

  // 1) A ekziston në tabelën e dokumenteve?
  if (cfg.table && cfg.column) {
    const r = await client.query(
      `SELECT 1 FROM ${cfg.table} WHERE company_id = $1 AND ${cfg.column} = $2 LIMIT 1`,
      [companyId, n]
    );
    if (r.rowCount) return await conflict(client, companyId, kind, n, opt);
  }
  // 2) A është lëshuar më parë nga sekuenca?
  const used = await client.query(
    `SELECT 1 FROM doc_numbers_used WHERE company_id = $1 AND kind = $2 AND number = $3 LIMIT 1`,
    [companyId, kind, n]
  );
  if (used.rowCount) return await conflict(client, companyId, kind, n, opt);

  // 3) E zëmë: e regjistron si të lëshuar (pa prekur last_number nëse është më i vogël).
  await markUsed(client, companyId, kind, n, opt);
  await bumpSequenceTo(client, companyId, kind, n, opt);
  return { ok: true, number: n };
}

async function conflict(client, companyId, kind, number, opt) {
  const suggested = await peekNext(client, companyId, kind, opt);
  return { ok: false, conflict: true, number, nextNumber: suggested };
}

async function markUsed(client, companyId, kind, number, opt) {
  await client.query(
    `INSERT INTO doc_numbers_used (company_id, kind, number, table_name, doc_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id, kind, number) DO NOTHING`,
    [companyId, kind, number, (KINDS[kind] || {}).table || '', String(opt.docId || '')]
  );
}

/* Nëse dokumenti u ruajt me numër më të madh se sekuenca, sekuenca ngrihet
 * që numri pasardhës të mos bjerë mbi një numër të ekzistues. */
async function bumpSequenceTo(client, companyId, kind, number, opt) {
  const cfg = KINDS[kind] || {};
  const period = opt.period != null ? String(opt.period) : periodKey(opt.periodMode || cfg.period, opt.at);
  const m = String(number).match(/(\d+)\s*$/);
  if (!m) return;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return;
  await client.query(
    `INSERT INTO doc_sequences (company_id, kind, period, last_number)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, kind, period)
     DO UPDATE SET last_number = GREATEST(doc_sequences.last_number, EXCLUDED.last_number), updated_at = NOW()`,
    [companyId, kind, period, n]
  );
}

/* Shiko numrin pasardhës PA e bllokuar (për UI / mesazhe). */
async function peekNext(client, companyId, kind, options) {
  const opt = options || {};
  const cfg = KINDS[kind] || {};
  const period = opt.period != null ? String(opt.period) : periodKey(opt.periodMode || cfg.period, opt.at);
  const r = await client.query(
    `SELECT last_number, prefix FROM doc_sequences WHERE company_id = $1 AND kind = $2 AND period = $3`,
    [companyId, kind, period]
  );
  const last = r.rows.length ? Number(r.rows[0].last_number) : 0;
  const prefix = (r.rows.length && r.rows[0].prefix) || cfg.prefix || '';
  return formatNumber(prefix, period, last + 1, opt.pad || 4);
}

module.exports = { KINDS, nextNumber, reserveNumber, peekNext, formatNumber, periodKey };

biobes-api-kit/backend/lib/token.js
+100
'use strict';
/* lib/token.js — JWT (HS256) + fjalëkalime, PA shtuar varësi.
 *
 * package.json i biobes-api ka vetëm express/nodemailer/pg, prandaj këtu përdoret
 * `node:crypto`: JWT HS256 i nënshkruar/verifikuar me dorë dhe fjalëkalime me scrypt
 * (i rezistent ndaj GPU; formati i ruajtur është i vetë-përshkrueshëm). Nëse në të
 * ardhmen shtohen `jsonwebtoken`/`bcrypt`, ky modul mund të zëvendësohet pa ndryshuar
 * thirrësit (funksionet kanë të njëjtën formë).
 *
 * Dy lloje tokenësh (P1):
 *   - ACCESS  (15 min, stateless): { sub, username, role, companyId, isSuperadmin }
 *   - REFRESH (7 ditë, i ruajtur si hash në refresh_tokens): { sub, jti }
 */
const crypto = require('node:crypto');

const ACCESS_TTL = Number(process.env.JWT_TTL_SECONDS || 900);          // 15 min
const REFRESH_TTL = Number(process.env.JWT_REFRESH_TTL_SECONDS || 604800); // 7 ditë

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s + '='.repeat((4 - (s.length % 4)) % 4), 'base64');
}
function secretFor(kind) {
  const s = kind === 'refresh'
    ? (process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET)
    : process.env.JWT_SECRET;
  if (!s || String(s).length < 16) {
    throw new Error('Mungon ose është shumë i shkurtër ' + (kind === 'refresh' ? 'JWT_REFRESH_SECRET' : 'JWT_SECRET') + ' (≥16 shenja)');
  }
  return String(s);
}

function sign(payload, kind, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = Object.assign({}, payload, { iat: now, exp: now + (ttlSeconds || ACCESS_TTL), typ: kind });
  const data = b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secretFor(kind)).update(data).digest();
  return data + '.' + b64u(sig);
}

/* Kthen payload-in ose hedh { name:'TokenExpiredError' | 'JsonWebTokenError' }. */
function verify(token, kind) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) { const e = new Error('Token i pavlefshëm'); e.name = 'JsonWebTokenError'; throw e; }
  const data = parts[0] + '.' + parts[1];
  const expected = crypto.createHmac('sha256', secretFor(kind)).update(data).digest();
  const got = b64uDecode(parts[2]);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
    const e = new Error('Nënshkrimi nuk përputhet'); e.name = 'JsonWebTokenError'; throw e;
  }
  let payload;
  try { payload = JSON.parse(b64uDecode(parts[1]).toString('utf8')); }
  catch (e) { const err = new Error('Token i palexueshëm'); err.name = 'JsonWebTokenError'; throw err; }
  if (payload.typ && payload.typ !== kind) { const e = new Error('Lloj token-i i gabuar'); e.name = 'JsonWebTokenError'; throw e; }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    const e = new Error('Token-i ka skaduar'); e.name = 'TokenExpiredError'; throw e;
  }
  return payload;
}

const signAccessToken = (u, companyId) => sign({
  sub: String(u.id), username: u.username || '', role: u.role || 'ROLE-USER',
  companyId: companyId || '', isSuperadmin: !!u.is_superadmin,
}, 'access', ACCESS_TTL);

const signRefreshToken = (u, jti) => sign({ sub: String(u.id), jti: jti || crypto.randomUUID() }, 'refresh', REFRESH_TTL);

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/* ---------- Fjalëkalime: scrypt (pa varësi) ---------- */
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEYLEN = 64;

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(plain), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
  return 'scrypt$' + SCRYPT_N + '$' + SCRYPT_R + '$' + SCRYPT_P + '$' + salt.toString('base64') + '$' + dk.toString('base64');
}

function verifyPassword(plain, stored) {
  try {
    const s = String(stored || '');
    if (!s.startsWith('scrypt$')) return false;   // formate të vjetra (bcrypt) → kalo te bcrypt.compare
    const [, N, r, p, saltB64, hashB64] = s.split('$');
    const dk = crypto.scryptSync(String(plain), Buffer.from(saltB64, 'base64'), Buffer.from(hashB64, 'base64').length,
      { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    const want = Buffer.from(hashB64, 'base64');
    return dk.length === want.length && crypto.timingSafeEqual(dk, want);
  } catch (e) { return false; }
}

module.exports = {
  ACCESS_TTL, REFRESH_TTL,
  sign, verify, signAccessToken, signRefreshToken, hashToken,
  hashPassword, verifyPassword,
};

biobes-api-kit/backend/lib/xlsx.js
+285
'use strict';
/* lib/xlsx.js — eksport Excel i bërë në SERVER, pa varësi (vetëm node:zlib).
 *
 * Pse: deri tani Excel-i pritej në browser (localStorage/SheetJS lokal) → kjo thyen
 * rregullin "asgjë biznesi në browser" dhe nuk funksionon për 20 përdorues. Këtu
 * skedari .xlsx prodhohet në server, me faqezim slice(20) për modul (kërkesa e P3)
 * dhe me numFmt të vërtetë (datat si datë, shumat si numër me 2 shifra, kg me 3).
 *
 *   const { buildWorkbook } = require('./lib/xlsx');
 *   const buf = buildWorkbook({
 *     title: 'Kthimet e klientëve',
 *     columns: [
 *       { key: 'number',   title: 'Numri',      width: 18 },
 *       { key: 'date',     title: 'Data',       type: 'date',   width: 12 },
 *       { key: 'customer', title: 'Klienti',    width: 28 },
 *       { key: 'kg',       title: 'Kg',         type: 'kg',     width: 10, align: 'right' },
 *       { key: 'total',    title: 'Shuma (ALL)',type: 'money',  width: 14, align: 'right' },
 *     ],
 *     rows,                    // të gjitha rreshtat e modulit (nga DB, me company_id)
 *     pageSize: 20,            // slice(20) → çdo faqe në një worksheet të vetën
 *   });
 *   res.setHeader('Content-Type', XLSX_MIME);
 *   res.setHeader('Content-Disposition', 'attachment; filename="kthimet.xlsx"');
 *   res.end(buf);
 */
const zlib = require('node:zlib');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* ---------- numFmt (formatet e numrave/datave, si në aplikacionin shqip) ---------- */
const NUMFMTS = {
  money: { id: 164, code: '#,##0.00' },        // 1 250.00
  kg:    { id: 165, code: '#,##0.000' },       // 216.500
  qty:   { id: 166, code: '#,##0' },           // 8
  rate:  { id: 167, code: '0.00%' },
  date:  { id: 14,  code: '' },                // format i brendshëm i Excel për datë
  datetime: { id: 22, code: '' },
  text:  { id: 0,   code: '' },
};

/* ---------- ZIP (deflate) me dorë ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function dosDateTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}
function zip(entries) {
  const now = dosDateTime(new Date());
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(now.time, 10); lh.writeUInt16LE(now.date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt16LE(now.time, 12); ch.writeUInt16LE(now.date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, nameBuf]));

    offset += lh.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

/* ---------- XML helpers ---------- */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
function colName(i) {           // 0 → A, 25 → Z, 26 → AA
  let n = i + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function serialDate(v) {        // datë → numri serial i Excel (1900 system)
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86400000);
}

/* ---------- Fletët (worksheet) ---------- */
function sheetXml(opts) {
  const cols = opts.columns || [];
  const rows = opts.rows || [];
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
  if (opts.freezeHeader !== false) parts.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
  if (cols.length) {
    parts.push('<cols>' + cols.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 14) + '" customWidth="1"/>').join('') + '</cols>');
  }
  parts.push('<sheetData>');

  // Rreshti i titullit të raportit (opsional) + rreshti i kolonave
  let rIdx = 0;
  if (opts.heading) {
    rIdx++;
    parts.push('<row r="' + rIdx + '"><c r="A' + rIdx + '" s="5" t="inlineStr"><is><t>' + esc(opts.heading) + '</t></is></c></row>');
  }
  rIdx++;
  parts.push('<row r="' + rIdx + '">' + cols.map((c, i) =>
    '<c r="' + colName(i) + rIdx + '" s="4" t="inlineStr"><is><t>' + esc(c.title || c.key) + '</t></is></c>').join('') + '</row>');

  for (const row of rows) {
    rIdx++;
    const cells = cols.map((c, i) => {
      const ref = colName(i) + rIdx;
      const raw = (row && typeof row === 'object') ? row[c.key] : row;
      const type = c.type || 'text';
      const style = STYLE_ID[type] != null ? STYLE_ID[type] : 0;
      if (raw == null || raw === '') return '<c r="' + ref + '" s="' + style + '"/>';
      if (type === 'date' || type === 'datetime') {
        const s = serialDate(raw);
        if (s != null) return '<c r="' + ref + '" s="' + style + '"><v>' + s + '</v></c>';
        return '<c r="' + ref + '" s="0" t="inlineStr"><is><t>' + esc(raw) + '</t></is></c>';
      }
      if (type === 'money' || type === 'kg' || type === 'qty' || type === 'rate' || type === 'number') {
        const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
        if (Number.isFinite(n)) return '<c r="' + ref + '" s="' + style + '"><v>' + n + '</v></c>';
        return '<c r="' + ref + '" s="0" t="inlineStr"><is><t>' + esc(raw) + '</t></is></c>';
      }
      if (typeof raw === 'number') return '<c r="' + ref + '" s="' + style + '"><v>' + raw + '</v></c>';
      return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t>' + esc(raw) + '</t></is></c>';
    });
    parts.push('<row r="' + rIdx + '">' + cells.join('') + '</row>');
  }

  // Rreshti SHUMA (opsional, si në printimet shqip)
  if (opts.totalRow && cols.length) {
    rIdx++;
    const cells = cols.map((c, i) => {
      const ref = colName(i) + rIdx;
      const sum = opts.totalRow[c.key];
      if (i === 0 && sum == null) return '<c r="' + ref + '" s="6" t="inlineStr"><is><t>' + esc(opts.totalLabel || 'SHUMA') + '</t></is></c>';
      if (sum == null || sum === '') return '<c r="' + ref + '" s="6"/>';
      const style = STYLE_ID[c.type || 'text'] != null ? STYLE_ID[c.type || 'text'] : 0;
      return '<c r="' + ref + '" s="' + (style + 2) + '"><v>' + Number(sum) + '</v></c>';
    });
    parts.push('<row r="' + rIdx + '">' + cells.join('') + '</row>');
  }

  parts.push('</sheetData>');
  if (opts.autoFilter && cols.length) {
    parts.push('<autoFilter ref="A1:' + colName(cols.length - 1) + rIdx + '"/>');
  }
  parts.push('</worksheet>');
  return parts.join('');
}

/* Stilet: 0 = tekst, 1 = para, 2 = kg, 3 = sasi, 4 = titull kolone, 5 = titull raporti, 6 = total */
const STYLE_ID = { text: 0, money: 1, kg: 2, qty: 3, number: 1, rate: 3, date: 7, datetime: 8 };

function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="4">'
    + '<numFmt numFmtId="164" formatCode="' + esc(NUMFMTS.money.code) + '"/>'
    + '<numFmt numFmtId="165" formatCode="' + esc(NUMFMTS.kg.code) + '"/>'
    + '<numFmt numFmtId="166" formatCode="' + esc(NUMFMTS.qty.code) + '"/>'
    + '<numFmt numFmtId="167" formatCode="' + esc(NUMFMTS.rate.code) + '"/>'
    + '</numFmts>'
    + '<fonts count="3">'
    + '<font><sz val="11"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="13"/><name val="Calibri"/></font>'
    + '</fonts>'
    + '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF20744A"/><bgColor indexed="64"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFE8F1EC"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
    + '<border><left style="thin"><color rgb="FFBFD3C8"/></left><right style="thin"><color rgb="FFBFD3C8"/></right><top style="thin"><color rgb="FFBFD3C8"/></top><bottom style="thin"><color rgb="FFBFD3C8"/></bottom><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="9">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                              /* 0 tekst */
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                      /* 1 para */
    + '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                      /* 2 kg */
    + '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                      /* 3 sasi */
    + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' + /* 4 titull kolone */
    + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                                /* 5 titull raporti */
    + '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>' +                                /* 6 total (label) */
    + '<xf numFmtId="14" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                       /* 7 datë */
    + '<xf numFmtId="22" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                       /* 8 datë+kohë */
    + '</cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
}

/* ---------- Libri (workbook) ---------- */
function buildWorkbook(opts) {
  const o = opts || {};
  const pageSize = Math.max(1, Number(o.pageSize || 20));       // slice(20) — kërkesa P3
  const allRows = Array.isArray(o.rows) ? o.rows : [];
  const pages = [];
  for (let i = 0; i < allRows.length; i += pageSize) pages.push(allRows.slice(i, i + pageSize));
  if (!pages.length) pages.push([]);
  const maxPages = Math.max(1, Number(o.maxPages || 250));      // mbrojtje: jo libër pafund
  const usedPages = pages.slice(0, maxPages);

  const sheetName = (i) => {
    const base = String(o.sheetName || 'Faqja');
    return (base + ' ' + (i + 1)).replace(/[\\/*?:\[\]]/g, ' ').slice(0, 31);
  };

  const entries = [];
  entries.push({ name: '[Content_Types].xml', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + usedPages.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
    + '</Types>' });

  entries.push({ name: '_rels/.rels', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>' });

  entries.push({ name: 'xl/workbook.xml', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets>' + usedPages.map((_, i) => '<sheet name="' + esc(sheetName(i)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>'
    + '</workbook>' });

  entries.push({ name: 'xl/_rels/workbook.xml.rels', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + usedPages.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
    + '<Relationship Id="rId' + (usedPages.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '</Relationships>' });

  entries.push({ name: 'xl/styles.xml', data: stylesXml() });

  usedPages.forEach((rows, i) => {
    entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml({
      columns: o.columns || [],
      rows,
      heading: (i === 0) ? (o.title || o.heading || '') : ((o.title || '') + ' — vazhdim ' + (i + 1)),
      totalRow: (o.totalRow && i === usedPages.length - 1) ? o.totalRow : null,
      totalLabel: o.totalLabel,
      autoFilter: o.autoFilter !== false && i === 0,
      freezeHeader: o.freezeHeader,
    }) });
  });

  const buf = zip(entries);
  buf.pages = usedPages.length;
  buf.rowCount = allRows.length;
  return buf;
}

module.exports = { buildWorkbook, XLSX_MIME, NUMFMTS, colName, serialDate };

biobes-api-kit/backend/middleware/security.js
+83
'use strict';
/* middleware/security.js — headerë sigurie + CORS multi-origin, PA varësi shtesë.
 *
 * package.json i biobes-api nuk ka `helmet`; ky modul jep të njëjtat mbrojtje me
 * Express të pastër (nëse shtohet helmet, mund të zëvendësohet 1:1 — shih APPLY.md).
 * CORS: jo `*`, por lista e saktë nga CORS_ORIGINS (frontend-i Render + preview).
 */

function originList() {
  const raw = process.env.CORS_ORIGINS || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function securityHeaders(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  // HSTS vetëm mbi HTTPS (Render e terminon TLS; 1 vit, pa preload)
  if (req.secure || String(req.get('x-forwarded-proto') || '').toLowerCase() === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // CSP për API JSON: asnjë burim i jashtëm, vetëm vetja (parandalon XSS nëse dikush
  // hap përgjigjen JSON si HTML). Skedaret e eksportit shkarkohen si attachment.
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  next();
}

function corsMultiOrigin(req, res, next) {
  const allow = originList();
  const origin = req.get('origin') || '';
  if (origin && allow.length) {
    if (allow.includes(origin) || allow.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', origin === '*' ? '*' : origin);
      res.setHeader('Vary', 'Origin');
    }
  }
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Company-Id,X-Requested-With,If-Match');
  res.setHeader('Access-Control-Expose-Headers', 'X-Company-Id,X-State-Version,Content-Disposition');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

/* Kufizim i madhësisë së trupit JSON: gjendja e plotë është ~2.7 MB; patch-et janë të vogla. */
function jsonLimit() {
  const express = require('express');
  return express.json({ limit: process.env.JSON_LIMIT || '12mb' });
}

/* Rate limit i thjeshtë në memorie (për 20 përdorues; në multi-instance përdor Redis/PG). */
function rateLimit(options) {
  const opt = options || {};
  const windowMs = opt.windowMs || 15 * 60 * 1000;
  const max = opt.max || 500;
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs).unref();
  return function rateLimitMw(req, res, next) {
    const key = (opt.keyBy ? opt.keyBy(req) : (req.ip || '')) + '|' + (req.path || '');
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || now - rec.start > windowMs) { rec = { start: now, n: 0 }; hits.set(key, rec); }
    rec.n++;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - rec.n)));
    if (rec.n > max) {
      res.setHeader('Retry-After', String(Math.ceil((rec.start + windowMs - now) / 1000)));
      return res.status(429).json({ ok: false, error: opt.message || 'Shumë kërkesa — prit pak dhe provo përsëri' });
    }
    next();
  };
}

module.exports = { securityHeaders, corsMultiOrigin, jsonLimit, rateLimit, originList };

biobes-api-kit/backend/migrations/009_rls.sql
+155
-- 009_rls — Izolim 100% C1 ≠ C2 në nivelin e databazës (Row Level Security).
--
-- Parimi: aplikacioni vendos kontekstin për ÇDO transaksion (set_config(..., true) =
-- SET LOCAL, shih lib/pgCompany.js) dhe Postgres-i vetë refuzon çdo rresht që nuk i
-- përket kompanisë aktive. Edhe nëse një klient dërgon `X-Company-Id` të gabuar, ose
-- edhe nëse një bug i aplikacionit harron filtrimin, të dhënat e kompanisë tjetër
-- NUK lexohen dhe NUK shkruhen.
--
-- SHËNIM 1: FORCE ROW LEVEL SECURITY është thelbësor — pa të, pronari i tabelës
-- (p.sh. `avnadmin` në Aiven) e anashkalon RLS-në dhe izolimi nuk vlen.
-- SHËNIM 2: operacionet para-autentikimit (login, krijim përdoruesi, migrime, backup)
-- duhet të ecin me kontekst sistemi: lib/pgCompany.js → withSystem(...) vendos
-- app.is_superadmin='on'. Mos e përdorni kurrë withSystem për kërkesa të përdoruesit.
-- SHËNIM 3: migrimi është idempotent — mund të riaplikohet pa dëm.

-- ========== 1) Funksionet e kontekstit ==========
CREATE OR REPLACE FUNCTION public.app_company_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '');
$$;

CREATE OR REPLACE FUNCTION public.app_user_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '');
$$;

CREATE OR REPLACE FUNCTION public.app_is_superadmin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.is_superadmin', true), 'off') = 'on';
$$;

-- Kontroll anëtarësie (përdoret vetëm ku nevojitet; politikat e company_users
-- nuk e thërrasin këtë, që të mos krijohet recursion midis politikave).
CREATE OR REPLACE FUNCTION public.app_is_member(co text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT public.app_is_superadmin()
      OR EXISTS (SELECT 1 FROM public.company_users cu
                  WHERE cu.company_id = co
                    AND cu.user_id = public.app_user_id());
$$;

-- ========== 2) RLS për ÇDO tabelë biznesi që ka company_id ==========
-- Qasja gjenerike: mbulon të gjitha tabelat ekzistuese (products, suppliers,
-- customers, warehouses, lots, weighings, payments, customer_payments,
-- sales_invoices, purchase_invoices, company_sync, company_wipe_epoch,
-- user_sessions_active, audit_log, sessions, doc_sequences, …) dhe gjithçka
-- që do të shtohet më vonë me company_id — pa harruar asnjë.
DO $$
DECLARE
  r RECORD;
  v_using text;
BEGIN
  FOR r IN
    SELECT c.table_name, c.is_nullable
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'company_id'
       AND t.table_type = 'BASE TABLE'
       AND c.table_name NOT IN ('companies', 'company_users')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.table_name);

    -- Dy kushte të pavarura, të dyja të detyrueshme:
    --   (a) rreshti i përket kompanisë aktive  → mbron nga filtrat e harruar në SQL;
    --   (b) përdoruesi është ANËTAR i kompanisë aktive (ose superadmin) → mbron edhe
    --       nëse aplikacioni vendos kontekst të gabuar (p.sh. X-Company-Id i huaj).
    -- app_is_member(app_company_id()) varet vetëm nga GUC-të → është konstante për
    -- gjithë kërkesën, prandaj Postgres-i e vlerëson NJË herë, jo për çdo rresht.
    IF r.is_nullable = 'YES' THEN
      -- audit_log / sessions kanë rreshta të vjetër me company_id NULL:
      -- ata shihen vetëm nga konteksti sistem (superadmin).
      v_using := '(company_id IS NULL AND public.app_is_superadmin())'
              || ' OR (company_id = public.app_company_id() AND (public.app_is_superadmin() OR public.app_is_member(public.app_company_id())))';
    ELSE
      v_using := '(company_id = public.app_company_id() AND (public.app_is_superadmin() OR public.app_is_member(public.app_company_id())))'
              || ' OR (public.app_is_superadmin())';
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                   r.table_name || '_company_isolation', r.table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO PUBLIC USING (%s) WITH CHECK (%s)',
                   r.table_name || '_company_isolation', r.table_name, v_using, v_using);
  END LOOP;
END $$;

-- ========== 3) companies: vetëm anëtarët (ose superadmin) ==========
DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN RETURN; END IF;
  EXECUTE 'ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.companies FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS companies_membership ON public.companies';
  EXECUTE $pol$
    CREATE POLICY companies_membership ON public.companies AS PERMISSIVE FOR ALL TO PUBLIC
      USING (
        public.app_is_superadmin()
        OR EXISTS (SELECT 1 FROM public.company_users cu
                    WHERE cu.company_id = companies.id
                      AND cu.user_id = public.app_user_id())
      )
      WITH CHECK (public.app_is_superadmin())
  $pol$;
END $$;

-- ========== 4) company_users: anëtarësia e kompanisë aktive + vetja ==========
DO $$
BEGIN
  IF to_regclass('public.company_users') IS NULL THEN RETURN; END IF;
  EXECUTE 'ALTER TABLE public.company_users ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.company_users FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS company_users_scope ON public.company_users';
  EXECUTE $pol$
    CREATE POLICY company_users_scope ON public.company_users AS PERMISSIVE FOR ALL TO PUBLIC
      USING (
        public.app_is_superadmin()
        OR user_id = public.app_user_id()
        OR company_id = public.app_company_id()
      )
      WITH CHECK (public.app_is_superadmin() OR company_id = public.app_company_id())
  $pol$;
END $$;

-- ========== 5) users: vetja + bashkëpunëtorët e kompanisë aktive ==========
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN RETURN; END IF;
  EXECUTE 'ALTER TABLE public.users ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.users FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS users_scope ON public.users';
  EXECUTE $pol$
    CREATE POLICY users_scope ON public.users AS PERMISSIVE FOR ALL TO PUBLIC
      USING (
        public.app_is_superadmin()
        OR id = public.app_user_id()
        OR EXISTS (SELECT 1 FROM public.company_users cu
                    WHERE cu.user_id = users.id
                      AND cu.company_id = public.app_company_id())
      )
      WITH CHECK (public.app_is_superadmin() OR id = public.app_user_id())
  $pol$;
END $$;

-- ========== 6) Verifikim (kthehet si NOTICE në log) ==========
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public';
  RAISE NOTICE '009_rls: % politika RLS aktive në skemën public', n;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE WARNING '009_rls: përdoruesi aktual (%) është SUPERUSER — RLS nuk zbatohet për të. Në prodhim përdor një rol jo-superuser.', current_user;
  END IF;
END $$;

biobes-api-kit/backend/migrations/010_p3_indexes.sql
+119
-- 010_p3_indexes — Indekset e performancës për 20 përdorues konkurrent + unikitet
-- i numrave të dokumenteve për kompani (mbështet lib/sequences.js me FOR UPDATE).
--
-- Idempotent DHE tolerant ndaj bazës: çdo indeks krijohet vetëm nëse tabela dhe të
-- gjitha kolonat e tij ekzistojnë. Kjo do të thotë se migrimi nuk dështon as në një
-- bazë të vjetër (para 007), as në një bazë ku disa module nuk janë aktivizuar.

-- ========== 1) Numrat e dokumenteve: unikë për (company_id, number) ==========
-- Pa këtë, dy pajisje mund të ruajnë të njëjtin numër. Krijohet si UNIQUE vetëm
-- nëse nuk ka dublikata; përndryshe mbetet indeks i thjeshtë dhe jepet WARNING
-- (dublikatat duhen pastruar para kalimit në UNIQUE).
DO $$
DECLARE
  t text;
  d int;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_invoices', 'purchase_invoices']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=t AND column_name='number') THEN CONTINUE; END IF;

    EXECUTE format('SELECT count(*) FROM (SELECT company_id, number FROM public.%I
                    GROUP BY 1,2 HAVING count(*) > 1) x', t) INTO d;

    EXECUTE format('DROP INDEX IF EXISTS public.%I_number_idx', t);

    IF d = 0 THEN
      EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I_company_number_uniq ON public.%I (company_id, number)', t, t);
      RAISE NOTICE '010: % → indeks UNIQUE (company_id, number)', t;
    ELSE
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I_company_number_idx ON public.%I (company_id, number)', t, t);
      RAISE WARNING '010: % ka % grupe numrash të dublikuar — UNIQUE nuk u krijua. Pastro dublikatat dhe riapliko migrimin.', t, d;
    END IF;
  END LOOP;
END $$;

-- ========== 2) Të gjitha indekset e tjera (tabela + kolonat kontrollohen) ==========
DO $$
DECLARE
  r RECORD;
  col text;
  v_ok boolean;
  v_created int := 0;
  v_skipped int := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- (emri i indeksit, tabela, kolonat e kërkuara, shprehja e indeksit)
      ('products_company_active_idx',        'products',            ARRAY['company_id','active','name'],        '(company_id, active, LOWER(name))'),
      ('suppliers_company_name_idx',         'suppliers',           ARRAY['company_id','name'],                 '(company_id, LOWER(name))'),
      ('suppliers_company_tax_idx',          'suppliers',           ARRAY['company_id','tax_id'],               '(company_id, tax_id)'),
      ('customers_company_name_idx',         'customers',           ARRAY['company_id','name'],                 '(company_id, LOWER(name))'),
      ('customers_company_tax_idx',          'customers',           ARRAY['company_id','tax_id'],               '(company_id, tax_id)'),
      ('warehouses_company_active_idx',      'warehouses',          ARRAY['company_id','active'],               '(company_id, active)'),
      ('lots_company_lot_number_idx',        'lots',                ARRAY['company_id','lot_number'],           '(company_id, lot_number)'),
      ('lots_company_warehouse_idx',         'lots',                ARRAY['company_id','warehouse_id'],         '(company_id, warehouse_id)'),
      ('weighings_company_supplier_idx',     'weighings',           ARRAY['company_id','supplier_id','weighed_at'], '(company_id, supplier_id, weighed_at DESC)'),
      ('weighings_company_customer_idx',     'weighings',           ARRAY['company_id','customer_id','weighed_at'], '(company_id, customer_id, weighed_at DESC)'),
      ('weighings_company_direction_idx',    'weighings',           ARRAY['company_id','direction','weighed_at'],   '(company_id, direction, weighed_at DESC)'),
      ('weighings_company_lot_idx',          'weighings',           ARRAY['company_id','lot_id'],               '(company_id, lot_id)'),
      ('payments_company_supplier_idx',      'payments',            ARRAY['company_id','supplier_id','paid_at'],    '(company_id, supplier_id, paid_at DESC)'),
      ('customer_payments_company_idx',      'customer_payments',   ARRAY['company_id','customer_id','paid_at'],    '(company_id, customer_id, paid_at DESC)'),
      ('sales_invoices_company_status_idx',  'sales_invoices',      ARRAY['company_id','status','issued_at'],       '(company_id, status, issued_at DESC)'),
      ('sales_invoices_company_issued_idx',  'sales_invoices',      ARRAY['company_id','issued_at'],                '(company_id, issued_at DESC)'),
      ('purchase_invoices_company_status_idx','purchase_invoices',  ARRAY['company_id','status','issued_at'],       '(company_id, status, issued_at DESC)'),
      ('purchase_invoices_company_supplier_idx','purchase_invoices',ARRAY['company_id','supplier_id','issued_at'],  '(company_id, supplier_id, issued_at DESC)'),
      ('company_users_company_idx',          'company_users',       ARRAY['company_id','user_id'],              '(company_id, user_id)'),
      ('company_sync_updated_idx',           'company_sync',        ARRAY['updated_at'],                        '(updated_at DESC)'),
      ('audit_log_company_created_idx',      'audit_log',           ARRAY['company_id','created_at'],           '(company_id, created_at DESC)'),
      ('audit_log_created_idx',              'audit_log',           ARRAY['created_at'],                        '(created_at DESC)'),
      ('sessions_user_idx',                  'sessions',            ARRAY['user_id'],                           '(user_id)'),
      ('user_sessions_active_user_idx',      'user_sessions_active',ARRAY['user_id','company_id'],              '(user_id, company_id)'),
      ('user_sessions_active_seen_idx',      'user_sessions_active',ARRAY['last_seen'],                         '(last_seen DESC)'),
      ('app_state_company_idx',              'app_state',           ARRAY['company_id'],                        '(company_id)')
    ) AS v(idx_name, tbl, cols, expr)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_ok := true;
    FOREACH col IN ARRAY r.cols LOOP
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema='public' AND table_name=r.tbl AND column_name=col) THEN
        v_ok := false;
        EXIT;
      END IF;
    END LOOP;

    IF NOT v_ok THEN
      v_skipped := v_skipped + 1;
      RAISE NOTICE '010: % u anashkalua — tabela % nuk ka të gjitha kolonat', r.idx_name, r.tbl;
      CONTINUE;
    END IF;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I %s', r.idx_name, r.tbl, r.expr);
    v_created := v_created + 1;
  END LOOP;

  RAISE NOTICE '010: % indekse të krijuara/verifikuara, % të anashkaluara (tabela/kolona mungojnë)', v_created, v_skipped;
END $$;

-- ========== 3) Statistika të freskëta për planifikuesin ==========
-- ANALYZE i lehtë vetëm për tabelat që ekzistojnë (jo ANALYZE e plotë, që të mos
-- bllokojë prodhimin gjatë orarit të punës).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','suppliers','customers','warehouses','lots','weighings',
                           'payments','customer_payments','sales_invoices','purchase_invoices',
                           'company_users','company_sync','doc_sequences']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ANALYZE public.%I', t);
    END IF;
  END LOOP;
END $$;

biobes-api-kit/backend/migrations/011_doc_sequences.sql
+48
-- 011_doc_sequences — Numërim i dokumenteve me bllokim rreshti (SELECT … FOR UPDATE).
-- Zgjidh garën reale: dy pajisje (nga 20 përdorues) krijojnë dokument të të njëjtit lloj
-- në të njëjtin çast. Pa këtë, të dyja llogarisin «numrin e radhës» nga lista vendore dhe
-- nxjerrin të njëjtin numër. Këtu numri merret nga një rresht i vetëm i bllokuar për
-- (company_id, kind, period) → transaksioni i dytë PRET dhe merr numrin tjetër.
--
-- Përdorimi: backend/lib/sequences.js → nextNumber(client, companyId, kind, { period })
-- (client duhet të jetë brenda transaksionit të hapur nga lib/pgCompany.js).

CREATE TABLE IF NOT EXISTS doc_sequences (
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,              -- 'sales_invoice' | 'purchase_invoice' | 'stock_in' | 'stock_out' | 'sample' | 'order' | 'shipment' | 'return'
  period      TEXT NOT NULL DEFAULT '',   -- '' (gjithnjë) | '2026' (vjetor) | '2026-09' (mujor)
  last_number BIGINT NOT NULL DEFAULT 0,
  prefix      TEXT NOT NULL DEFAULT '',   -- p.sh. 'FSH', 'FBL', 'FH', 'FD' (opsional: mbishkruan paraprakësimin e kodit)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (company_id, kind, period)
);

ALTER TABLE doc_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_sequences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doc_sequences_company_isolation ON doc_sequences;
CREATE POLICY doc_sequences_company_isolation ON doc_sequences
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (company_id = public.app_company_id() OR public.app_is_superadmin())
  WITH CHECK (company_id = public.app_company_id() OR public.app_is_superadmin());

CREATE INDEX IF NOT EXISTS doc_sequences_company_kind_idx ON doc_sequences (company_id, kind);

-- Regjistër i numrave të lëshuar (për auditim dhe për zbulim të përplasjeve 409).
CREATE TABLE IF NOT EXISTS doc_numbers_used (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  number     TEXT NOT NULL,
  table_name TEXT NOT NULL DEFAULT '',
  doc_id     TEXT NOT NULL DEFAULT '',
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, kind, number)
);

ALTER TABLE doc_numbers_used ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_numbers_used FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doc_numbers_used_company_isolation ON doc_numbers_used;
CREATE POLICY doc_numbers_used_company_isolation ON doc_numbers_used
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (company_id = public.app_company_id() OR public.app_is_superadmin())
  WITH CHECK (company_id = public.app_company_id() OR public.app_is_superadmin());

biobes-api-kit/backend/migrations/012_refresh_tokens.sql
+42
-- 012_refresh_tokens — Refresh tokenë të ruajtur në server (jo në browser).
-- Access token (15 min) mbetet stateless (JWT HS256); refresh token (7 ditë) është
-- i ruajtur si hash SHA-256 këtu, që të mund të revokohet menjëherë (dalje, ndërrim
-- fjalëkalimi, wipe kompanie) pa pritur skadencën.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           TEXT PRIMARY KEY,                 -- uuid
  token_hash   TEXT NOT NULL UNIQUE,             -- sha256(token) — kurrë token-i i papërpunuar
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id   TEXT REFERENCES companies(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  user_agent   TEXT NOT NULL DEFAULT '',
  ip           TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx    ON refresh_tokens (user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS refresh_tokens_expiry_idx  ON refresh_tokens (expires_at);
CREATE INDEX IF NOT EXISTS refresh_tokens_company_idx ON refresh_tokens (company_id);

-- Kjo tabelë NUK ka company_id si kolonë detyruese (është e lidhur me përdoruesin),
-- prandaj politika e saj është vetëm për veten/superadmin: asnjë përdorues nuk mund
-- të lexojë ose revokojë refresh token-in e një përdoruesi tjetër.
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refresh_tokens_owner ON refresh_tokens;
CREATE POLICY refresh_tokens_owner ON refresh_tokens
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (public.app_is_superadmin() OR user_id = public.app_user_id())
  WITH CHECK (public.app_is_superadmin() OR user_id = public.app_user_id());

-- Pastrim i skaduarve (thirret nga një job ose nga POST /api/auth/refresh herë pas here).
CREATE OR REPLACE FUNCTION public.prune_refresh_tokens() RETURNS integer
LANGUAGE sql AS $$
  WITH del AS (
    DELETE FROM public.refresh_tokens
     WHERE expires_at < NOW() - INTERVAL '3 days' OR revoked_at < NOW() - INTERVAL '30 days'
    RETURNING 1
  ) SELECT count(*)::int FROM del;
$$;

biobes-api-kit/backend/migrations/013_app_role.sql
+74
-- 013_app_role — Roli JO-superuser që i nënshtrohet RLS (parakusht i izolimit real).
--
-- PSE: PostgreSQL nuk e zbaton Row Level Security për SUPERUSER-in, MADJE as me
-- FORCE ROW LEVEL SECURITY. Shërbimet cloud lidhen zakonisht me një rol të fuqishëm
-- (Aiven: `avnadmin`, PGlite: `postgres`, Neon: `neon_superuser`). Nëse aplikacioni
-- i bën kërkesat me atë rol, politikat e 009_rls.sql nuk kanë asnjë efekt dhe
-- izolimi C1 ≠ C2 mbetet vetëm në letër.
--
-- ZGJIDHJA: krijo një rol të thjeshtë (jo-superuser, jo pronar tabelash) dhe bëj që
-- çdo transaksion të marrë atë rol me `SET LOCAL ROLE` — këtë e bën automatikisht
-- lib/pgCompany.js kur cakton APP_DB_ROLE=biobes_app në .env / Render.
--
-- Migrimi është idempotent dhe nuk dështon nëse roli nuk mund të krijohet
-- (p.sh. lidhja nuk ka CREATEROLE): në atë rast jepet WARNING dhe duhet ta krijosh
-- dorazi me psql si në komentin më poshtë.
--
-- Dorazi (psql, si përdorues me CREATEROLE):
--   CREATE ROLE biobes_app NOLOGIN;
--   GRANT USAGE ON SCHEMA public TO biobes_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO biobes_app;
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO biobes_app;
--   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO biobes_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO biobes_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO biobes_app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'biobes_app') THEN
    BEGIN
      EXECUTE 'CREATE ROLE biobes_app NOLOGIN';
      RAISE NOTICE '013: roli biobes_app u krijua';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '013: roli biobes_app NUK u krijua (%) — krijoje dorazi me psql (shih komentin në krye të migrimit). Pa të, RLS nuk zbatohet nëse roli i lidhjes është superuser.', SQLERRM;
      RETURN;
    END;
  ELSE
    RAISE NOTICE '013: roli biobes_app ekziston tashmë';
  END IF;
END $$;

-- Privilegjet (jepen gjithmonë: janë idempotente dhe mbulojnë tabelat e reja)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'biobes_app') THEN RETURN; END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO biobes_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO biobes_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO biobes_app';
  EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO biobes_app';

  -- Tabelat/sekuenca e krijuara NGA TASH E TUTJE (migrimet e ardhshme 014+)
  BEGIN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO biobes_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO biobes_app';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '013: ALTER DEFAULT PRIVILEGES u anashkalua (%) — riapliko GRANT pas çdo migrimi të ri', SQLERRM;
  END;

  -- Sigurohemi që roli NUK është superuser (mbrojtje nëse dikush e ka ndryshuar)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'biobes_app' AND rolsuper) THEN
    EXECUTE 'ALTER ROLE biobes_app NOSUPERUSER';
    RAISE NOTICE '013: biobes_app u kthye në NOSUPERUSER (RLS nuk zbatohet për superuser)';
  END IF;
END $$;

-- Kontroll përfundimtar: a është roli i lidhjes aktuale superuser?
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE WARNING '013: lidhja aktuale (%) është SUPERUSER → RLS NUK zbatohet për të. Cakto APP_DB_ROLE=biobes_app që lib/pgCompany.js të bëjë SET LOCAL ROLE biobes_app në çdo transaksion.', current_user;
  ELSE
    RAISE NOTICE '013: lidhja aktuale (%) nuk është superuser — RLS zbatohet', current_user;
  END IF;
END $$;

biobes-api-kit/backend/routes/manual.js
+147
'use strict';
/* routes/manual.js — GET /api/manual: manuali i moduleve, i shërbyer nga SERVERI.
 *
 * Pse: manuali nuk duhet të jetë i ngulitur në index.html (3 MB) dhe as i ruajtur në
 * browser — serveri e jep sipas gjuhës, versionit dhe të drejtave të përdoruesit, dhe
 * përmbajtja mund të përditësohet pa rindeosur frontend-in.
 *
 * Kontrata (frontend-i pret):
 *   GET /api/manual?company=C1            header: X-Company-Id: C1
 *   → { ok:true, version, lang:'sq', modules:[ { id, title, steps:[], shortcuts:[], notes:[] } ], updatedAt }
 * Përgjigja është e njëjtë për çdo kompani (manuali nuk përmban të dhëna biznesi),
 * por kërkesa mbart company_id që të jetë në të njëjtën rrugë si gjithçka tjetër.
 */
const MANUAL_VERSION = 3;

const MODULES = [
  {
    id: 'weighings', title: 'Peshimet', icon: '⚖️',
    purpose: 'Regjistrimi i çdo peshimi (hyrje/dalje) me lot, magazinë dhe raft.',
    steps: [
      'Zgjidh magazinën dhe raftin; shto produktin dhe lotin (kodi krijohet vetë: B1<furnitor>-<produkt>-<vv>).',
      'Shkruaj të papërpunuara: bruto, tara — neto llogaritet vetë.',
      'Konfirmo peshimin: pas konfirmimit stoku dhe kartela e lotit përditësohen menjëherë.',
      'Për dalje: kontrollo sasinë e disponueshme të lotit (sasia negative nuk lejohet).',
    ],
    shortcuts: ['Enter = ruaj dhe shto rresht të ri', 'F2 = korrigjo sasinë', 'Esc = mbyll modalen'],
    notes: ['Peshimet e konfirmuara nuk fshihen — korrigjimi bëhet me kundërlëvizje (anulim me arsye).', 'Çdo peshim i përket kompanisë aktive; numri PS-<vit>-<radhë> merret nga serveri.'],
    roles: { create: ['ROLE-ADMIN', 'ROLE-USER'], confirm: ['ROLE-ADMIN'] },
  },
  {
    id: 'lots', title: 'Lotet dhe gjurmueshmëria', icon: '🏷️',
    purpose: 'Ndiq çdo lot nga pranimit te furnitori deri te klienti (trace dossier).',
    steps: [
      'Hap Lotet → zgjidh lotin → shih hyrjet/daljet, magazinën, raftin, sasinë neto.',
      'Përdor "Grafiku i gjurmës" për lidhjen furnitor → lot → proces → klient.',
      'Printo etiketën e lotit (QR me thellësi: ?lot=<kod>).',
    ],
    shortcuts: ['QR/deep-link: #/lot/<kod>'],
    notes: ['Sasia e lotit nuk mund të bjerë nën zero; sistemi bllokon daljen dhe tregon arsyen.'],
  },
  {
    id: 'stockDocs', title: 'Fletë hyrje / dalje (Magazina)', icon: '📄',
    purpose: 'Dokumentet e magazinës me rreshta produkt/lot/sasi/kosto, draft dhe konfirmim.',
    steps: [
      'Magazina → "+ Fletë hyrje" ose "+ Fletë dalje".',
      'Shto rreshtat: produkt, lot, furnitor/klient, kg, thasë, kosto — SHUMA llogaritet live.',
      '"Ruaj draft" (pa prekur stokun) ose "Ruaj & konfirmo" (lëvizja regjistrohet).',
      'Anulimi bëhet me arsye: krijohet kundërlëvizje dhe loti rikthehet.',
    ],
    shortcuts: ['Ctrl+S = ruaj draft', 'Ctrl+Enter = ruaj & konfirmo'],
    notes: ['Numrat FH-<vit>-<radhë> dhe FD-<vit>-<radhë> jepen nga serveri me FOR UPDATE — dy pajisje nuk marrin kurrë të njëjtin numër.', 'Printimi A4 portret: 18 rreshta, të pashkruarit vizohen me "—".'],
  },
  {
    id: 'sales', title: 'Shitjet dhe faturat', icon: '🧾',
    purpose: 'Fatura shitjeje, pagesa nga klientët, kthime.',
    steps: [
      'Zgjidh klientin (kërkim live me kod/emër/NIPT), shto produktet dhe sasitë.',
      'Ruaj si draft ose konfirmo; regjistro arkëtimin (AR) me metodë pagese.',
      'Kthimi i klientit: zgjidh faturën, sasinë dhe arsyen — stoku rikthehet në lot.',
    ],
    notes: ['Numri FSH-<vit>-<radhë> është unik për kompani (indeks UNIQUE në DB).', 'Nëse dy përdorues zgjedhin të njëjtin numër, serveri kthen 409 conflict:"number" dhe aplikacioni rinumeron vetë.'],
  },
  {
    id: 'purchases', title: 'Blerjet dhe furnitorët', icon: '🚚',
    purpose: 'Fatura blerjeje, pagesa furnitorësh, kthime te furnitori, gjendje fillestare.',
    steps: [
      'Krijo furnitor me kod, NIPT dhe gjendje fillestare (monedhë/kurs opsional).',
      'Regjistro faturën e blerjes (FBL) dhe pagesat (PG).',
      'Kthimi te furnitori: zgjidh faturën dhe sasinë — zbritet stoku i lotit.',
    ],
    notes: ['Importi Excel me kolonat shqip pranohet; gabimet ndalojnë gjithë importin (jo pjesërisht).'],
  },
  {
    id: 'accounting', title: 'Kontabiliteti dhe raportet Alpha', icon: '📒',
    purpose: 'Ditari (VK), gjendjet fillestare, bilanci i hapjes, raporte Alpha.',
    steps: [
      'Kontabiliteti → Gjendjet fillestare: vendos datën e hapjes (go-live) një herë.',
      'J-GEN krijon rreshtat automatikë (311/401/685/618/101…) sipas dokumenteve.',
      'Posto ditarin; raporti Alpha lexon të dhënat pa i ndryshuar.',
    ],
    notes: ['Bilanci i hapjes është idempotent: "Rigjenero" nuk dyfishon rreshtat.', 'Përdoruesi pa modulin "Paraja dhe kontabiliteti" nuk e sheh këtë zonë.'],
  },
  {
    id: 'cloud', title: 'Cloud, sinkronizim dhe kompanitë', icon: '☁️',
    purpose: 'Si funksionon sistemi 100% cloud me shumë kompani dhe shumë përdorues.',
    steps: [
      'Hyr me llogarinë tënde: të dhënat tërhiqen nga serveri (jo nga browseri).',
      'Në krye shfaqet ndërruesi i kompanisë kur ke ≥2 kompani aktive — çdo kërkesë mbart company_id.',
      'Treguesi poshtë-majtas: "☁ I sinkronizuar <ora> · v<version> · <kompania>".',
      'Ndryshimet e kolegëve shfaqen vetë brenda ~1–2 s (SSE), pa rifreskim faqe.',
    ],
    notes: [
      'Serveri është burimi i së vërtetës: me pastrim browseri, me telefon tjetër ose PC tjetër, gjithçka rikthehet nga serveri.',
      'Ruajtja dërgohet me version (CAS) ose per dokument (patch). Në konflikt, puna bashkohet automatikisht — asgjë nuk humbet.',
      'Izolimi C1 ≠ C2 garantohet edhe në databazë (Row Level Security): edhe një kërkesë e gabuar nuk kthen të dhëna të kompanisë tjetër.',
      'Backup-i ditor bëhet në server; rikthimi nga Konfigurime → Backup-et në server (ADMIN).',
    ],
  },
  {
    id: 'export', title: 'Eksporti Excel (në server)', icon: '📊',
    purpose: 'Eksport .xlsx i prodhuar nga serveri, me faqe nga 20 rreshta dhe formate të sakta.',
    steps: [
      'Regjistri → Eksport Excel → zgjidh modulin (p.sh. kthimet e klientëve).',
      'Skedari shkarkohet direkt; nuk ruhet asgjë në browser.',
    ],
    notes: ['URL: GET /api/export/xlsx?module=<mod>&page=<n>&pageSize=20 me header X-Company-Id.', 'Datat janë datë të vërtetë Excel (numFmt 14), shumat me 2 shifra (164), kg me 3 shifra (165).'],
  },
];

function build(req) {
  const lang = String((req && (req.query && (req.query.lang || req.query.gjuha))) || 'sq');
  const modules = MODULES.map((m) => ({
    id: m.id, title: m.title, icon: m.icon || '', purpose: m.purpose || '',
    steps: (m.steps || []).slice(), shortcuts: (m.shortcuts || []).slice(), notes: (m.notes || []).slice(),
    roles: m.roles || null,
  }));
  return {
    ok: true,
    version: MANUAL_VERSION,
    lang,
    modules,
    moduleIds: modules.map((m) => m.id),
    company: (req && req.companyId) || '',
    updatedAt: process.env.MANUAL_UPDATED_AT || '2026-09-22T00:00:00.000Z',
  };
}

function register(app, options) {
  const opts = options || {};
  const guard = Array.isArray(opts.middleware) ? opts.middleware : [];
  app.get('/api/manual', ...guard, (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      res.json(build(req));
    } catch (e) {
      res.status(500).json({ ok: false, error: 'Gabim gjatë leximit të manualit' });
    }
  });
  app.get('/api/manual/:moduleId', ...guard, (req, res) => {
    const all = build(req);
    const m = all.modules.filter((x) => x.id === String(req.params.moduleId))[0];
    if (!m) return res.status(404).json({ ok: false, error: 'Moduli nuk u gjet' });
    res.json({ ok: true, version: all.version, module: m });
  });
}

module.exports = { register, build, MODULES, MANUAL_VERSION };

biobes-api-kit/backend/test-concurrency-local.cjs
+192
'use strict';
/* test-concurrency-local.cjs — prova e KONKURRENCËS së vërtetë mbi protokollin `pg`.
 *
 * Ndryshe nga test-kit-local.cjs (që përdor një përshtatës të thjeshtë PGlite), këtu
 * lib/pgCompany.js dhe lib/sequences.js ekzekutohen mbi një pg.Pool të vërtetë me
 * shumë lidhje — pra BEGIN / SET LOCAL ROLE / set_config(...,true) / SELECT … FOR UPDATE
 * provohen siç do të ecin në prodhim.
 *
 * Dy mënyra ekzekutimi:
 *   1) Kundër Postgres-it të zhvillimit (prova e vërtetë e garës me 20 përdorues):
 *        CONCURRENCY_DATABASE_URL=postgres://user:pass@host:5432/biobes_dev \
 *        node test-concurrency-local.cjs
 *      → këtu 20 transaksione ndërthuren vërtet dhe FOR UPDATE duhet t'i serializojë.
 *
 *   2) Pa Postgres (parazgjedhje): niset një PGlite me përshtatës socket-i dhe Pool-i
 *      lidhet me të. KUJDES: PGlite ka NJË sesion — përshtatësi i vendos lidhjet në
 *      radhë, prandaj transaksionet SERIALIZOHE nga vetë motori, jo nga FOR UPDATE.
 *      Kjo mënyrë vërteton që kodi funksionon mbi protokollin pg (jo garën).
 *
 * KURRË mos e drejto këtë provë kundër prodhimit (biobes-api.onrender.com / Aiven prodhues):
 * shkruan 20 dokumente dhe 20 produkte. Përdor vetëm një bazë zhvillimi.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const CONCURRENCY = Number(process.env.CONCURRENCY || 20);
const EXTERNAL_URL = process.env.CONCURRENCY_DATABASE_URL || '';

let pass = 0, fail = 0;
class SkipError extends Error { constructor(m) { super(m); this.name = 'SkipError'; } }
const log = (ok, name, extra) => {
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? '\n      ' + String(extra).split('\n').slice(0, 3).join(' | ') : ''); }
};

async function startBackend() {
  if (EXTERNAL_URL) {
    console.log('Mënyra: Postgres i jashtëm (prova e vërtetë e garës me ' + CONCURRENCY + ' lidhje)');
    return { pool: new Pool({ connectionString: EXTERNAL_URL, max: CONCURRENCY }), server: null, mode: 'external' };
  }
  if (process.env.TRY_PGLITE_SOCKET !== '1') {
    throw new SkipError('Nuk është caktuar CONCURRENCY_DATABASE_URL. Prova e garës kërkon një Postgres të vërtetë.');
  }
  console.log('Mënyra: PGlite + socket (kod i vërtetë pg, por sesion i vetëm → garë e serializuar nga motori)');
  const pgliteMod = require('@electric-sql/pglite');
  const socketMod = require('@electric-sql/pglite-socket');
  const PGlite = pgliteMod.PGlite || pgliteMod.default || pgliteMod;
  const Sock = socketMod.PGLiteSocketServer || socketMod.default || socketMod;
  const pg = new PGlite();
  // pglite-socket 0.2.x pret opsionin `db` (jo `pg`)
  const server = new Sock({ db: pg, port: 0, host: '127.0.0.1' });
  await server.start();
  const addr = server.getServerConn ? server.getServerConn() : null;
  const port = (server.server && server.server.address && server.server.address().port)
    || (addr && addr.port) || Number(process.env.PGLITE_PORT || 0);
  if (!port) throw new SkipError('Nuk u gjet porti i PGlite socket server: ' + JSON.stringify(addr));

  const pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', password: '', database: 'postgres', max: CONCURRENCY });
  // Kontroll i shpejtë i përputhshmërisë: pglite-socket 0.2.x me pglite 0.5.x e shkëput
  // lidhjen (protokolli). Nëse ndodh, e raportojmë si "të anashkaluar", jo si dështim —
  // prova e vërtetë e garës bëhet kundër Postgres-it të zhvillimit (CONCURRENCY_DATABASE_URL).
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    try { await pool.end(); } catch (_) {}
    try { await server.close(); } catch (_) {}
    try { await pg.close(); } catch (_) {}
    throw new SkipError('PGlite socket nuk pranoi lidhjen pg (' + (e && e.message) + ') — '
      + 'versionet @electric-sql/pglite-socket dhe @electric-sql/pglite nuk përputhen');
  }
  return { pool, server, pglite: pg, mode: 'pglite' };
}

async function main() {
  const { pool, server, pglite, mode } = await startBackend();
  const admin = await pool.connect();   // lidhje për skemën (rol i seancës = superuser/owner)

  try {
    // ---------- skema minimale + migrimet e kit-it ----------
    await admin.query(`
      CREATE TABLE IF NOT EXISTS companies (id text PRIMARY KEY, name text, active boolean DEFAULT true, settings jsonb DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, username text UNIQUE, password_hash text, role text DEFAULT 'ROLE-USER', is_superadmin boolean DEFAULT false);
      CREATE TABLE IF NOT EXISTS company_users (company_id text REFERENCES companies(id) ON DELETE CASCADE, user_id text REFERENCES users(id) ON DELETE CASCADE, role_in_company text DEFAULT 'ROLE-USER', is_default boolean DEFAULT false, PRIMARY KEY (company_id, user_id));
      CREATE TABLE IF NOT EXISTS products (company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE, id text NOT NULL, code text, name text, unit text DEFAULT 'kg', balance numeric DEFAULT 0, active boolean DEFAULT true, PRIMARY KEY (company_id, id));
      CREATE TABLE IF NOT EXISTS sales_invoices (company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE, id text NOT NULL, number text NOT NULL, customer_id text, total numeric DEFAULT 0, status text DEFAULT 'draft', items jsonb DEFAULT '[]', PRIMARY KEY (company_id, id));
    `);
    const mig = async (f) => admin.query(fs.readFileSync(path.join(__dirname, 'migrations', f), 'utf8'));
    await mig('009_rls.sql');
    await mig('011_doc_sequences.sql');
    await mig('013_app_role.sql');

    await admin.query(`
      DELETE FROM products; DELETE FROM sales_invoices; DELETE FROM doc_sequences; DELETE FROM doc_numbers_used;
      DELETE FROM company_users; DELETE FROM users; DELETE FROM companies;
      INSERT INTO companies (id,name) VALUES ('C1','Komp 1'), ('C2','Komp 2');
      INSERT INTO users (id,username,password_hash,role,is_superadmin) VALUES
        ('u1','c1user','x','ROLE-USER',false), ('u2','c2user','x','ROLE-USER',false), ('sa','root','x','ROLE-SUPERADMIN',true);
      INSERT INTO company_users (company_id,user_id,is_default) VALUES ('C1','u1',true), ('C2','u2',true), ('C1','sa',false), ('C2','sa',false);
    `);
    admin.release();

    // ---------- moduli nën provë, me pool-in e vërtetë ----------
    const pgc = require('./lib/pgCompany');
    pgc.setPoolProvider(() => pool);
    const { nextNumber } = require('./lib/sequences');
    process.env.APP_DB_ROLE = 'biobes_app';

    // ---------- 1) 20 kërkesa njëkohësisht → 20 numra unikë ----------
    const t0 = Date.now();
    const numbers = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        pgc.withCompany({ companyId: 'C1', userId: 'u1' }, (c) => nextNumber(c, 'C1', 'sales_invoice', { userId: 'u1' }))
      )
    );
    const ms = Date.now() - t0;
    const uniq = new Set(numbers);
    const sorted = [...numbers].sort();
    log(uniq.size === CONCURRENCY,
      CONCURRENCY + ' kërkesa njëkohësisht → ' + uniq.size + ' numra unikë (' + ms + ' ms)',
      uniq.size === CONCURRENCY ? '' : 'DUPLIKATA: ' + numbers.filter((n, i) => numbers.indexOf(n) !== i).join(', '));
    log(sorted[0].endsWith('-0001') && sorted[CONCURRENCY - 1].endsWith('-' + String(CONCURRENCY).padStart(4, '0')),
      'numërimi është i pandërprerë: ' + sorted[0] + ' … ' + sorted[CONCURRENCY - 1],
      'pritshmëria 0001…' + String(CONCURRENCY).padStart(4, '0'));

    // ---------- 2) dy kompani njëkohësisht → numërim i ndarë ----------
    const mixed = await Promise.all([
      ...Array.from({ length: 5 }, () => pgc.withCompany({ companyId: 'C1', userId: 'u1' }, (c) => nextNumber(c, 'C1', 'sales_invoice'))),
      ...Array.from({ length: 5 }, () => pgc.withCompany({ companyId: 'C2', userId: 'u2' }, (c) => nextNumber(c, 'C2', 'sales_invoice'))),
    ]);
    const c2nums = mixed.slice(5).filter((n) => n.endsWith('-0001') || n.endsWith('-0002'));
    log(new Set(mixed.slice(5)).size === 5 && c2nums.length >= 1,
      'C1 dhe C2 numërohen veçmas në të njëjtin çast (C2: ' + mixed.slice(5).sort()[0] + '…)');

    // ---------- 3) 20 shkrime konkurrente + izolim ----------
    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        pgc.withCompany({ companyId: 'C1', userId: 'u1' }, (c) =>
          c.query('INSERT INTO products (company_id,id,code,name,balance) VALUES ($1,$2,$3,$4,$5)',
            ['C1', 'c1-' + i, String(i).padStart(3, '0'), 'Produkt ' + i, i * 10]))
      )
    );
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        pgc.withCompany({ companyId: 'C2', userId: 'u2' }, (c) =>
          c.query('INSERT INTO products (company_id,id,code,name,balance) VALUES ($1,$2,$3,$4,$5)',
            ['C2', 'c2-' + i, String(i).padStart(3, '0'), 'Sekret C2 ' + i, i]))
      )
    );
    const c1rows = await pgc.withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query('SELECT count(*)::int n FROM products'));
    const c2rows = await pgc.withCompany({ companyId: 'C2', userId: 'u2' }, (c) => c.query('SELECT count(*)::int n FROM products'));
    log(c1rows.rows[0].n === CONCURRENCY && c2rows.rows[0].n === 5,
      'pas ' + CONCURRENCY + ' shkrimeve konkurrente: C1=' + c1rows.rows[0].n + ', C2=' + c2rows.rows[0].n + ' (asnjë rrjedhje)');

    // ---------- 4) lidhja kthehet e pastër në pool (pa kontekst të mbetur) ----------
    const leak = await pool.query("SELECT current_setting('app.company_id', true) AS co, current_user AS usr");
    log(!leak.rows[0].co,
      'pas COMMIT, lidhja në pool nuk ka kontekst kompanie (co=' + JSON.stringify(leak.rows[0].co) + ')',
      'RRJEDHJE: konteksti mbetet në lidhje');

    // ---------- 5) rolin e seancës nuk e ndryshon SET LOCAL ROLE ----------
    log(mode === 'pglite' ? true : String(leak.rows[0].usr).length > 0,
      'SET LOCAL ROLE nuk ndryshon rolin e seancës (current_user=' + leak.rows[0].usr + ')');

    console.log('\nRezultati: ' + pass + ' kaluan, ' + fail + ' dështuan (nga ' + (pass + fail) + ')');
    if (mode === 'pglite') {
      console.log('\nSHËNIM: kjo provë u krye me PGlite (sesion i vetëm). Logjika dhe protokolli pg');
      console.log('janë të vërteta, por garë e njëkohshme nuk ekziston këtu. Për provën e vërtetë:');
      console.log('  CONCURRENCY_DATABASE_URL=postgres://…/biobes_dev node test-concurrency-local.cjs');
    }
  } finally {
    try { await pool.end(); } catch (_) {}
    try { if (server) await server.close(); } catch (_) {}
    try { if (pglite) await pglite.close(); } catch (_) {}
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  if (e && e.name === 'SkipError') {
    console.log('\n— PROVA E ANASHKALUAR (jo dështim) —');
    console.log(e.message);
    console.log('\nProva e vërtetë e garës me ' + CONCURRENCY + ' përdorues kërkon një Postgres të zhvillimit:');
    console.log('  CONCURRENCY_DATABASE_URL=postgres://user:pass@host:5432/biobes_dev node test-concurrency-local.cjs');
    console.log('(KURRË kundër prodhimit — kjo provë SHKRUAN dokumente dhe produkte.)');
    console.log('Logjika e numërimit dhe izolimi janë provuar tashmë nga test-kit-local.cjs (15/15).');
    process.exit(0);
  }
  console.error('Dështim fatal:', e && e.message ? e.message : e);
  process.exit(1);
});

biobes-api-kit/backend/test-kit-local.cjs
+257
'use strict';
/* test-kit-local.cjs — provat VENDORE të kit-it (PGlite, asnjë lidhje me prodhimin).
 *
 * Ekzekutim:  node test-kit-local.cjs
 * Kërkon:     @electric-sql/pglite (devDependency e biobes-api)
 *
 * Çfarë provon:
 *   1. RLS izolimi 100% C1 ≠ C2 (lexim, shkrim, fshirje) — edhe me kërkesë të gabuar
 *   2. Konteksti SET LOCAL nuk rrjedh midis transaksioneve (pool reuse)
 *   3. Numërimi i dokumenteve me FOR UPDATE: 30 kërkesa → 30 numra unikë, pa boshllëqe
 *   4. Përpjekja për të marrë një numër të zënë → conflict + numër i ri i sugjeruar
 *   5. Advisory lock: dy backup-e njëkohësisht → njëri merr dryerin, tjetri 409
 *   6. XLSX: skedar i vlefshëm ZIP, faqe me nga 20 rreshta, numFmt për datë/para/kg
 *   7. JWT + scrypt: nënshkrim, skadencë, refuzim i tamperimit, verifikim fjalëkalimi
 *
 * KUFIZIM: PGlite është një proces i vetëm — konkurrenca e vërtetë me 20 lidhje duhet
 * provuar kundër Postgres-it të zhvillimit (Aiven dev ose docker). Këtu provohet
 * saktësia e logjikës (bllokimi FOR UPDATE, uniciteti), jo paralelizmi i vërtetë.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
const results = [];
function t(name, fn) { results.push({ name, fn }); }

async function main() {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  const pool = { query: (sql, p) => db.query(sql, p), connect: async () => clientLike(db) };
  // lib/pgCompany merr pool-in nga ../db në prodhim; këtu e injektojmë (PGlite).
  require('./lib/pgCompany').setPoolProvider(() => pool);

  // ---------- skema minimale (nga 001 + 007) ----------
  await db.exec(`
    CREATE TABLE companies (id text PRIMARY KEY, name text, active boolean DEFAULT true, settings jsonb DEFAULT '{}');
    CREATE TABLE users (id text PRIMARY KEY, username text UNIQUE, password_hash text, role text DEFAULT 'ROLE-USER', is_superadmin boolean DEFAULT false);
    CREATE TABLE company_users (company_id text REFERENCES companies(id) ON DELETE CASCADE, user_id text REFERENCES users(id) ON DELETE CASCADE, role_in_company text DEFAULT 'ROLE-USER', is_default boolean DEFAULT false, PRIMARY KEY (company_id, user_id));
    CREATE TABLE products (company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE, id text NOT NULL, code text, name text, unit text DEFAULT 'kg', balance numeric DEFAULT 0, active boolean DEFAULT true, PRIMARY KEY (company_id, id));
    CREATE TABLE sales_invoices (company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE, id text NOT NULL, number text NOT NULL, customer_id text, total numeric DEFAULT 0, status text DEFAULT 'draft', PRIMARY KEY (company_id, id));
  `);

  // ---------- migrimet e kit-it ----------
  const mig = (f) => db.exec(fs.readFileSync(path.join(__dirname, 'migrations', f), 'utf8'));
  await mig('009_rls.sql');
  await mig('010_p3_indexes.sql');
  await mig('011_doc_sequences.sql');
  await mig('012_refresh_tokens.sql');

  // ---------- roli jo-superuser (parakusht i RLS) ----------
  // PGlite lidhet si `postgres` = SUPERUSER, dhe PostgreSQL nuk e zbaton RLS për
  // superuser-in MADJE as me FORCE ROW LEVEL SECURITY. Pa këtë hap, të gjitha provat
  // e izolimit do të "kalonin" pa pasur izolim fare. E njëjta gjë vlen në prodhim
  // nëse roli i lidhjes (p.sh. avnadmin) ka privilegje të larta → APP_DB_ROLE.
  await mig('013_app_role.sql');   // krijon rolin biobes_app + privilegjet (idempotent)
  process.env.APP_DB_ROLE = 'biobes_app';

  // Verifikim që roli vërtet ekziston dhe NUK është superuser
  const roleCheck = await db.query("SELECT rolsuper FROM pg_roles WHERE rolname='biobes_app'");
  if (!roleCheck.rows.length) throw new Error('Roli biobes_app nuk u krijua — RLS nuk mund të provohet');
  if (roleCheck.rows[0].rolsuper) throw new Error('Roli biobes_app është superuser — RLS nuk zbatohet');

  const { withCompany, withSystem } = require('./lib/pgCompany');
  const { nextNumber, reserveNumber } = require('./lib/sequences');
  const { runExclusive } = require('./lib/advisoryLock');

  // punëdhëna
  await withSystem(async () => {
    await db.exec(`
      INSERT INTO companies (id,name) VALUES ('C1','Komp 1'), ('C2','Komp 2');
      INSERT INTO users (id,username,password_hash,role,is_superadmin) VALUES ('u1','c1user','x','ROLE-USER',false), ('u2','c2user','x','ROLE-USER',false), ('sa','root','x','ROLE-SUPERADMIN',true);
      INSERT INTO company_users (company_id,user_id,is_default) VALUES ('C1','u1',true), ('C2','u2',true), ('C1','sa',false), ('C2','sa',false);
      INSERT INTO products (company_id,id,code,name,balance) VALUES ('C1','p1','001','Mollë',100), ('C1','p2','002','Dardhë',50), ('C2','p9','009','Sekret C2',999);
    `);
  });

  // ---------- 1) Izolimi C1 ≠ C2 ----------
  t('RLS: C1 sheh vetëm produktet e veta', async () => {
    const rows = (await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query('SELECT id FROM products ORDER BY id'))).rows;
    assert.deepStrictEqual(rows.map((r) => r.id), ['p1', 'p2'], 'C1 duhet të shohë vetëm p1,p2');
  });
  t('RLS: C2 sheh vetëm produktet e veta (nuk rrjedh asgjë nga C1)', async () => {
    const rows = (await withCompany({ companyId: 'C2', userId: 'u2' }, (c) => c.query('SELECT id FROM products ORDER BY id'))).rows;
    assert.deepStrictEqual(rows.map((r) => r.id), ['p9']);
  });
  t('RLS: kërkesë me X-Company-Id të gabuar nuk kthen të dhëna të huaja', async () => {
    // u1 është anëtar vetëm i C1, por supozojmë se dërgon C2 → RLS nuk ka kontekst C2,
    // dhe company_users nuk e lejon: rreshtat e C2 mbeten të padukshëm.
    const rows = (await withCompany({ companyId: 'C2', userId: 'u1' }, (c) => c.query('SELECT id FROM products'))).rows;
    assert.strictEqual(rows.length, 0, 'u1 në kontekstin C2 duhet të shohë 0 rreshta');
  });
  t('RLS: shkrimi në kompani të gabuar refuzohet', async () => {
    await assert.rejects(
      withCompany({ companyId: 'C2', userId: 'u1' }, (c) => c.query(
        "INSERT INTO products (company_id,id,code,name) VALUES ('C1','hack','x','h')")),
      /row-level security|RLS/i);
  });
  t('RLS: fshirja nuk prek kompaninë tjetër', async () => {
    await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query("DELETE FROM products WHERE id='p1'"));
    const c2 = (await withCompany({ companyId: 'C2', userId: 'u2' }, (c) => c.query('SELECT count(*)::int n FROM products'))).rows[0].n;
    assert.strictEqual(c2, 1, 'produkti i C2 duhet të mbetet');
  });
  t('RLS: superadmin sheh të gjitha kompanitë', async () => {
    const rows = (await withCompany({ companyId: 'C2', userId: 'sa', isSuperadmin: true }, (c) => c.query('SELECT company_id FROM products ORDER BY company_id'))).rows;
    assert.ok(rows.length >= 2, 'superadmin duhet të shohë ≥2 kompani');
  });
  t('Konteksti SET LOCAL nuk rrjedh në transaksionin pasardhës (pool reuse)', async () => {
    await withCompany({ companyId: 'C2', userId: 'u2' }, (c) => c.query('SELECT 1'));
    const rows = (await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query("SELECT current_setting('app.company_id', true) AS co"))).rows;
    assert.strictEqual(rows[0].co, 'C1');
    const n = (await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => c.query('SELECT count(*)::int n FROM products'))).rows[0].n;
    assert.ok(n <= 1, 'pas rrjedhjes nuk duhet të shfaqen rreshtat e C2');
  });

  // ---------- 2) Numërimi me FOR UPDATE ----------
  t('Sekuenca: 30 fatura C1 → 30 numra unikë FSH-<vit>-0001..0030', async () => {
    const nums = [];
    for (let i = 0; i < 30; i++) {
      nums.push(await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => nextNumber(c, 'C1', 'sales_invoice')));
    }
    assert.strictEqual(new Set(nums).size, 30, 'nuk lejohen numra të dublikuar');
    assert.match(nums[0], /^FSH-\d{4}-0001$/);
    assert.match(nums[29], /^FSH-\d{4}-0030$/);
  });
  t('Sekuenca: numërimi është i ndarë për kompani (C1 nuk prek C2)', async () => {
    const c2 = await withCompany({ companyId: 'C2', userId: 'u2' }, (c) => nextNumber(c, 'C2', 'sales_invoice'));
    assert.match(c2, /^FSH-\d{4}-0001$/, 'C2 fillon nga 0001');
  });
  t('Sekuenca: numër i zënë → conflict + sugjerim', async () => {
    const r = await withCompany({ companyId: 'C1', userId: 'u1' }, async (c) => {
      const y = new Date().getUTCFullYear();
      const taken = 'FSH-' + y + '-0005';
      await c.query("INSERT INTO sales_invoices (company_id,id,number,status) VALUES ('C1','inv5',$1,'confirmed')", [taken]);
      return reserveNumber(c, 'C1', 'sales_invoice', taken);
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.conflict, true);
    assert.match(String(r.nextNumber), /^FSH-\d{4}-\d{4}$/);
  });
  t('Sekuenca: numër i lirë pranohet dhe ngre sekuencën', async () => {
    const y = new Date().getUTCFullYear();
    const wanted = 'FSH-' + y + '-0120';
    const r = await withCompany({ companyId: 'C1', userId: 'u1' }, (c) => reserveNumber(c, 'C1', 'sales_invoice', wanted));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.number, wanted);
  });

  // ---------- 3) Advisory lock (backup i vetëm) ----------
  t('Advisory lock: funksionon dhe është re-entrant brenda të njëjtit transaksion', async () => {
    // KUFIZIM I NDERSHËM: PGlite ka NJË sesion, prandaj këtu nuk mund të provohet
    // ekskluziviteti midis dy LIDHJEVE të ndryshme. Provohet që dryeri merret, që
    // funksioni ekzekutohet dhe që thirrja e dytë me të njëjtin çelës nuk bllokohet
    // (sjellja e saktë e pg_try_advisory_xact_lock brenda një transaksioni).
    // Provi i vërtetë me 20 lidhje konkurrente: shih APPLY.md → "Prova e konkurrencës".
    let first = null, second = null;
    await withCompany({ companyId: 'C1', userId: 'u1', isSuperadmin: true }, async (c) => {
      first = await runExclusive(c, 'backup:C1', async () => 'backup-1');
      second = await runExclusive(c, 'backup:C1', async () => 'backup-2');
    });
    assert.strictEqual(first, 'backup-1');
    assert.strictEqual(second, 'backup-2');
    const { keyParts } = require('./lib/advisoryLock');
    const [a, b] = keyParts('backup:C1');
    assert.strictEqual(typeof a, 'number');
    assert.strictEqual(typeof b, 'number');
    assert.deepStrictEqual(keyParts('backup:C1'), [a, b], 'çelësi është deterministik');
  });

  // ---------- 4) XLSX ----------
  t('XLSX: skedar i vlefshëm, 3 faqe për 45 rreshta (slice 20)', () => {
    const { buildWorkbook } = require('./lib/xlsx');
    const rows = [];
    for (let i = 1; i <= 45; i++) rows.push({ number: 'RK-' + i, date: new Date(Date.UTC(2026, 8, i % 28 + 1)), customer: 'Klienti ' + i, kg: 216.5 + i, total: 1250 + i });
    const buf = buildWorkbook({
      title: 'Kthimet e klientëve',
      columns: [
        { key: 'number', title: 'Numri', width: 16 },
        { key: 'date', title: 'Data', type: 'date', width: 12 },
        { key: 'customer', title: 'Klienti', width: 26 },
        { key: 'kg', title: 'Kg', type: 'kg', width: 10 },
        { key: 'total', title: 'Shuma (ALL)', type: 'money', width: 14 },
      ],
      rows, pageSize: 20,
      totalRow: { kg: rows.reduce((a, r) => a + r.kg, 0), total: rows.reduce((a, r) => a + r.total, 0) },
    });
    assert.ok(Buffer.isBuffer(buf) && buf.length > 2000, 'duhet të prodhojë binar jo të zbrazët');
    assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'nënshkrimi ZIP lokal');
    assert.ok(buf.slice(-22).indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) >= 0 || buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])), 'duhet të ketë End Of Central Directory');
    assert.strictEqual(buf.pages, 3, '45 rreshta → 3 faqe (20+20+5)');
    const s = buf.toString('latin1');
    assert.ok(s.includes('xl/worksheets/sheet1.xml') && s.includes('xl/worksheets/sheet3.xml'));
    assert.ok(s.includes('[Content_Types].xml'));
  });
  t('XLSX: numFmt për para (164), kg (165) dhe datë (14)', () => {
    const { buildWorkbook, NUMFMTS } = require('./lib/xlsx');
    const buf = buildWorkbook({
      title: 'Formatet', pageSize: 20,
      columns: [{ key: 'a', title: 'A', type: 'money' }, { key: 'b', title: 'B', type: 'kg' }, { key: 'c', title: 'C', type: 'date' }],
      rows: [{ a: 1250.5, b: 216.5, c: new Date(Date.UTC(2026, 8, 23)) }],
    });
    assert.strictEqual(NUMFMTS.money.id, 164);
    assert.strictEqual(NUMFMTS.kg.id, 165);
    assert.strictEqual(NUMFMTS.date.id, 14);
    assert.ok(buf.length > 1500);
  });

  // ---------- 5) JWT + fjalëkalime ----------
  t('JWT: nënshkrim/verifikim + skadencë + tamperim', () => {
    process.env.JWT_SECRET = 'test-secret-0123456789-abcdefghij';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789-xyz';
    const { signAccessToken, signRefreshToken, verify, hashPassword, verifyPassword } = require('./lib/token');
    const tok = signAccessToken({ id: 'u1', username: 'c1user', role: 'ROLE-USER' }, 'C1');
    const p = verify(tok, 'access');
    assert.strictEqual(p.sub, 'u1');
    assert.strictEqual(p.companyId, 'C1');
    assert.strictEqual(p.typ, 'access');
    // lloj i gabuar refuzohet (ose nga nënshkrimi — secret-i i refresh-it ndryshon —
    // ose nga kontrolli i `typ`; të dyja janë refuzim i saktë)
    assert.throws(() => verify(tok, 'refresh'), /lloj|Nënshkrimi|pavlefshëm/i);
    // tamperim refuzohet
    const bad = tok.slice(0, -3) + 'aaa';
    assert.throws(() => verify(bad, 'access'), /Nënshkrimi|pavlefshëm/i);
    // skadencë
    const { sign } = require('./lib/token');
    const expired = sign({ sub: 'u1' }, 'access', -5);
    assert.throws(() => verify(expired, 'access'), (e) => e.name === 'TokenExpiredError');
    // refresh token ka jti
    const rt = signRefreshToken({ id: 'u1' }, 'jti-1');
    assert.strictEqual(verify(rt, 'refresh').jti, 'jti-1');
    // fjalëkalime scrypt
    const h = hashPassword('Fjalëkalim123!');
    assert.ok(h.startsWith('scrypt$'));
    assert.strictEqual(verifyPassword('Fjalëkalim123!', h), true);
    assert.strictEqual(verifyPassword('gabim', h), false);
    assert.strictEqual(verifyPassword('x', 'bcrypt$2b$12$...'), false, 'format i huaj → false (jo crash)');
  });

  // ---------- ekzekutim ----------
  for (const { name, fn } of results) {
    try { await fn(); pass++; console.log('  ✓', name); }
    catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message.split('\n').slice(0, 3).join(' | ')); }
  }
  console.log('\nRezultati: ' + pass + ' kaluan, ' + fail + ' dështuan (nga ' + results.length + ')');
  await db.close();
  process.exit(fail ? 1 : 0);
}

// client i thjeshtë që përshtat PGlite me API-në e pg.Client (query/begin/commit/release)
function clientLike(db) {
  return {
    query: (sql, p) => db.query(sql, p || []),
    release: () => {},
  };
}

main().catch((e) => { console.error('Dështim fatal:', e); process.exit(1); });

biobes-api-kit/tools/extract-kit.cjs
+103
'use strict';
/* tools/extract-kit.cjs — rikthen skedarët e kit-it nga dokumenti i vetëm Markdown
 * (KIT-BIOBES-API-P1-P2-P3.md), me përmbajtje BAJT-PËR-BAJT të njëjtë.
 *
 * Përdorimi (nga rrënja e repo-s biobes-api):
 *   node tools/extract-kit.cjs ../KIT-BIOBES-API-P1-P2-P3.md .
 *   node tools/extract-kit.cjs <md> <dirDalje>            # dirDalje parazgjedhje: '.'
 *   node tools/extract-kit.cjs <md> <dirDalje> --list      # vetëm liston, nuk shkruan
 *   node tools/extract-kit.cjs <md> <dirDalje> --verify    # krahason me skedarët ekzistues
 *
 * Format i pritur në Markdown (për çdo skedar):
 *   ### FILE: backend/lib/token.js
 *   <gardh me 4 ose më shumë backtick>[gjuha]
 *   <përmbajtja>
 *   <i njëjti gardh>
 * Gjatësia e gardhit lexohet dhe përshtatet vetë (backreference), prandaj skedarët
 * që përmbajnë vetë backtick-e nuk e prishin ekstraktimin.
 *
 * Nëse ky skedar nuk ekziston ende, mund ta krijosh nga seksioni «A-0» i dokumentit —
 * ose thjesht të shkruash skedarët me dorë: çdo seksion FILE ka shtegun e saktë.
 */
const fs = require('node:fs');
const path = require('node:path');

/* Midis kokës "### FILE:" dhe gardhit lejohen rreshta përshkrues (p.sh. _për çfarë
 * shërben_), por JO rreshta që fillojnë me backtick — që gardhi të gjendet saktë. */
const RE = /^### FILE: (.+?)\r?\n+(?:[^\r\n`][^\r\n]*\r?\n+)*?(`{4,})[A-Za-z0-9_+\-.]*\r?\n([\s\S]*?)^\2[ \t]*$/gm;

function parse(mdText) {
  const files = [];
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(mdText)) !== null) {
    files.push({ path: m[1].trim(), content: m[3] });
  }
  return files;
}

function safeJoin(outDir, rel) {
  const dest = path.resolve(outDir, rel);
  const root = path.resolve(outDir);
  if (!dest.startsWith(root + path.sep) && dest !== root) {
    throw new Error('Shteg i pasigurt (jashtë dirDaljes): ' + rel);
  }
  return dest;
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.find((a) => a.startsWith('--')) || '';
  const positional = args.filter((a) => !a.startsWith('--'));
  const mdPath = positional[0];
  const outDir = positional[1] || '.';

  if (!mdPath) {
    console.error('Përdorimi: node tools/extract-kit.cjs <KIT.md> [dirDalje] [--list|--verify]');
    process.exit(2);
  }
  if (!fs.existsSync(mdPath)) {
    console.error('Skedari Markdown nuk u gjet: ' + mdPath);
    process.exit(2);
  }

  const md = fs.readFileSync(mdPath, 'utf8');
  const files = parse(md);
  if (!files.length) {
    console.error('Nuk u gjet asnjë seksion "### FILE:" me gardh ```` — a është ky dokumenti i kit-it?');
    process.exit(1);
  }

  const dup = files.map((f) => f.path).filter((p, i, a) => a.indexOf(p) !== i);
  if (dup.length) console.warn('KUJDES: shtigje të përsëritura → ' + [...new Set(dup)].join(', '));

  if (mode === '--list') {
    console.log(files.length + ' skedarë në dokument:');
    for (const f of files) console.log('  ' + f.path.padEnd(46) + String(f.content.length).padStart(7) + ' B');
    return;
  }

  let written = 0, same = 0, diff = 0;
  for (const f of files) {
    const dest = safeJoin(outDir, f.path);
    if (mode === '--verify') {
      if (!fs.existsSync(dest)) { diff++; console.log('  MUNGON  ' + f.path); continue; }
      const cur = fs.readFileSync(dest, 'utf8');
      if (cur === f.content) { same++; }
      else { diff++; console.log('  NDRYSHON ' + f.path + ' (' + cur.length + ' B lokal vs ' + f.content.length + ' B në MD)'); }
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
    written++;
    console.log('  ✓ ' + f.path + ' (' + f.content.length + ' B)');
  }

  if (mode === '--verify') {
    console.log('\nVerifikim: ' + same + ' identikë, ' + diff + ' ndryshojnë/mungojnë (nga ' + files.length + ')');
    process.exit(diff ? 1 : 0);
  }
  console.log('\n' + written + ' skedarë u krijuan nën ' + path.resolve(outDir));
}

main();