# BioBes Cloud — Ndryshimet e reja (Faza 1 + 2)

## Përmbledhje
Biobes-api është kthyer nga një **MVP single-tenant me cache** në një
**sistem cloud me server autoritativ, shumë kompani, sinkronizim realtime**.

---

## Faza 1 — Rregullime kritike (bug-et e raportuara)

### Të rregulluara
1. **Kompanitë nuk fshihen më** nga shkrimet e cunguar të pajisjeve të tjera.
   - Serveri bën *merge mbrojtës* me state-in e serverit kur një klient dërgon
     state pa fushat kritike (`companies`, `products`, `customers`, `suppliers`,
     `warehouses`) dhe kthen `mergedFromServer: true` për t'i thënë klientit të
     ringarkojë.
2. **`fetchPolicy: server-authoritative`** — i tregohet frontend-it në çdo
   `GET /api/state` që serveri është burimi i së vërtetës dhe se duhet
   të mbishkruajë localStorage-in në çdo boot.
3. **SSE (Server-Sent Events)** në `/api/events` — të gjitha pajisjet marrin
   njoftim në kohë reale kur dikush tjetër bën ndryshim. Nuk ka më "duhet të
   dalësh/hysh për të parë të dhënat e reja".
4. **Event `wipe`** dërgohet në SSE në momentin e reset-it total, kështu që të
   gjitha pajisjet pastrojnë lokalisht menjëherë (nuk u shfaqet më backup).
5. **Kompanitë tani janë fushë e njohur** në validim, `access.js` (MOD-SET)
   dhe `SHARED_STATE_FIELDS` — nuk humbin dot nga filtri i moduleve.
6. **Ping çdo 25s** në SSE për ta mbajtur lidhjen gjallë në Render.

### Endpoint-e të reja
- `GET /api/events?token=...` — SSE (eventet: `connected`, `state-changed`, `wipe`)
- `GET /api/state/version` (ekzistonte më parë, i përsosur)

---

## Faza 2 — Multi-company e vërtetë (skemë relacionale)

### Skema e re
Tabela të vërteta në Postgres në vend të një JSONB monolit:
- `companies` — kompanitë
- `company_users` — lidhja user ↔ kompani (me `role_in_company`: owner/admin/manager/user)
- `products`, `suppliers`, `customers`, `warehouses`,
- `lots`, `weighings`,
- `payments`, `customer_payments`,
- `sales_invoices`, `purchase_invoices`,
- `company_sync` — version monotonik për kompani (për polling)
- `company_wipe_epoch` — shenja e wipe-it për çdo kompani

Çdo tabelë biznesi ka **PK e përbërë `(company_id, id)`** — izolim i plotë
në nivel databaze. Asnjë e dhënë e kompanisë A nuk mund të kthehet te kompania B
edhe nëse ka bug në kod (query-të përdorin gjithmonë `WHERE company_id=$1`).

### Middleware-i i kontekstit
- Çdo kërkesë me header `X-Company-Id: <id-kompanie>` ngarkon automatikisht
  `req.companyId` dhe `req.companyRole`.
- Nëse s'jepet header, zgjidhet kompania e vetme / default e userit.
- `company.requireCompany` kthen 400 nëse s'ka kompani.
- Superadmini (`ROLE-ADMIN` + `is_superadmin=true`) ka qasje në të gjitha.

### Endpoint-e CRUD (të gjitha `needAuth + company.requireCompany`)
| Metoda | Endpoint | Çfarë |
|---|---|---|
| GET | `/api/companies` | Listë e kompanive të userit |
| POST | `/api/companies` | Krijo kompani (vetëm admin) |
| PATCH | `/api/companies/:id` | Ndrysho profil |
| POST | `/api/companies/:id/select` | Ndërro kompani aktive |
| GET/POST/PATCH/DELETE | `/api/products` | Produktet e kompanisë |
| GET/POST/PATCH/DELETE | `/api/suppliers` | Furnitorët |
| GET/POST/PATCH/DELETE | `/api/customers` | Klientët |
| GET/POST/PATCH/DELETE | `/api/warehouses` | Magazinat |
| GET/POST/PATCH/DELETE | `/api/lots` | Lotet |
| GET/POST/PATCH/DELETE | `/api/weighings` | Peshimet |
| GET/POST/PATCH/DELETE | `/api/payments` | Pagesat |
| GET/POST/PATCH/DELETE | `/api/customer-payments` | Arkëtimet |
| GET/POST/PATCH/DELETE | `/api/sales-invoices` | Fatura shitjeje |
| GET/POST/PATCH/DELETE | `/api/purchase-invoices` | Fatura blerjeje |
| GET | `/api/sync/version` | Versioni i kompanisë (polling i shpejtë) |
| POST | `/api/admin/company/:id/wipe` | Reset për një kompani (s'i prek të tjerat) |

### Sinkronizimi realtime
Çdo CRUD thërret `bumpVersion(companyId, actor)` i cili:
1. Rrit `company_sync.version` (atomikisht).
2. Dërgon event SSE **vetëm** te klientët që janë në atë kompani:
   - `entity-changed`: ndryshim në të dhëna; klienti ringarkon listën.
   - `company-wiped`: kompania u pastrua; klienti pastron cache.

### Wipe për kompani
Nuk ekziston më "reset global". `/api/admin/company/:id/wipe` pastron të
gjitha tabelat e biznesit për atë kompani, por nuk prek:
- kompaninë e tjera
- përdoruesit
- audit log-un global (shton një hyrje `COMPANY_WIPE`)

---

## Faza 3 — Prodhimi

### Çfarë përfshin
- `render.yaml` i azhurnuar me `SYNC_ALL_MODULES=true` (default, për qasje të plotë të userave të serverit).
- `scripts/export:company` për eksport të një kompanie të vetme (backup logjik).
- Teste të shtuara: `npm run test:bugs`, `npm run test:multi`.
- Kodi ekzistues `/api/state` (JSONB monolit) mbahet për prapapajtueshmëri me frontend-in aktual; kur frontend-i të jetë përditësuar për CRUD-in e ri, `/api/state` mund të shënohet deprecated.

### Rekomandime para prodhimit
1. **Aiven Startup plan** — aktivizon PITR (2 ditë backup automatik).
2. **CORS_ORIGIN** caktoje domain-in tënd të aplikacionit (mos lejo `*`).
3. **Cron ditor për backup** (në Render ose GitHub Actions) që thërret:
   ```bash
   API_URL=https://biobes-api.onrender.com \
   ADMIN_USER=admin ADMIN_PASS=... COMPANY_ID=CO-xxx \
     npm run export:company -- backup-CO-xxx-$(date +%F).json
   ```
4. **SMTP** i konfiguruar për rivendosjen e fjalëkalimit (`SMTP_HOST/USER/PASS/FROM`).
5. **Rate limit** aktual është në memorie; për shkallëzim horizontal zëvendësoje me Redis.

---

## Si të përdoret nga frontend-i (kontrata e re)

1. **Login** → merr `token`, si më parë.
2. **`GET /api/auth/me`** → kthen `companies` (lista me emrat/ID-të) dhe `activeCompanyId`.
3. **Ruaj `activeCompanyId`** në UI (dropdown "Zgjidh kompaninë").
4. **Çdo kërkesë CRUD** dërgohet me header:
   ```
   Authorization: Bearer <token>
   X-Company-Id: CO-xxxx
   ```
5. **SSE**: lidhu në `/api/events?token=<token>`; merr evente `entity-changed`
   me `{companyId, version}` dhe ringarko të dhënat e asaj kompanie.
6. **Në boot**: MOS lexo localStorage si burim i së vërtetës — bëj `GET /api/<entity>`
   për secilën listë (ose `GET /api/sync/version` dhe krahaso me versionin e fundit
   për të parë nëse ka nevojë të ringarkosh).
7. **Nëse serveri kthen 409 `{wiped:true}`** ose merr event `company-wiped`,
   PASTROJE tërë cache-n lokale për atë kompani dhe ringarko.
