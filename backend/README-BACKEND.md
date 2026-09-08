# BioBes API — Backend (Aiven Postgres + Render)

API që i jep aplikacionit statik `index.html` **databazë të përbashkët** dhe **siguri server-side**.
Telefoni dhe kompjuteri përdorin të njëjtat të dhëna: aplikacioni hyn me kredenciale
serveri, tërheq gjendjen në login dhe e dërgon automatikisht në çdo ruajtje.

## Endpointet

| Metoda | Rruga | Çfarë bën | Qasja |
|---|---|---|---|
| GET | `/api/health` | statusi + lidhja DB | publike |
| POST | `/api/auth/login` | hyrje → token sesioni | publike (rate limit) |
| POST | `/api/auth/logout` | mbyll sesionin | e autentikuar |
| GET | `/api/auth/me` | profili aktual | e autentikuar |
| GET | `/api/state` | gjendja + versioni | e autentikuar |
| PUT | `/api/state` | ruan gjendjen (kontroll + version) | e autentikuar |
| GET | `/api/audit` | regjistri i veprimeve | vetëm admin |
| GET/POST | `/api/admin/users` | liston / krijon përdorues | vetëm admin |
| PATCH | `/api/admin/users/:id` | emri, roli, aktiv, passwordi | vetëm admin |
| POST | `/api/admin/wipe` | fshirja totale (`{password}` → `{ok:true}`) | password admini |

## Teknologjitë + komandat e publikimit

- **Node.js 20** (`NODE_VERSION: 20` në `render.yaml`, `engines >= 18`)
- **express 4**, **pg 8** — versionet fikse në `package-lock.json` (asgjë native)
- **Build Command:** `npm install --omit=dev`
- **Start Command:** `node server.js`
- **Health Check:** `/api/health`
- **SSL për Aiven:** `PGSSLMODE=require` (lidhje e enkriptuar). Opsionalisht vendos
  `PG_CA_CERT` (certifikata CA e Aiven-it, me `\n` të escap-uara) për verifikim të plotë.

## 1. Databaza në Aiven (5 minuta)

1. Krijo llogari në [aiven.io](https://aiven.io) → **Create service** → **PostgreSQL**.
2. Zgjidh planin më të vogël dhe regionin më të afërt (p.sh. Frankfurt).
3. Kur servisi është **Running**, hap **Overview** → kopjo **Service URI** (`postgres://...`).

## 2. Deploy në Render (5 minuta)

1. Krijo repo në GitHub (p.sh. `biobes-api`) → ngarko `render.yaml` + folderin `backend/`.
2. Render Dashboard → New → **Blueprint** → zgjidh repo-n → Apply.
3. Vendos: `DATABASE_URL` = Service URI e Aiven; `ADMIN_PASSWORD` = password i fortë
   (min 8, rekomandohet 12+) — ky krijon adminin në server.
4. Kontrollo: `https://biobes-api.onrender.com/api/health` → `{ok:true, db:true, ...}`.

> Plani falas "fle" pas pasivitetit — thirrja e parë zgjat ~30 sek. Normale.

## 3. Lidhja me aplikacionin

1. Aplikacioni → **Konfigurime → Zona e rrezikut → Lidhja me serverin** → URL e API-t → Ruaj.
2. **Dil dhe hyr përsëri** me kredencialet e serverit → gjendja tërhiqet automatikisht.
3. Po kjo në çdo pajisje (telefon + PC) → të dhëna të përbashkëta.
4. ⚠️ Për **Reset** të plotë, passwordi i adminit duhet të jetë **i njëjtë** në aplikacion dhe server.

## Rolet dhe përdoruesit

- `ROLE-ADMIN` — gjithçka, përfshirë `/api/audit`, menaxhimin e përdoruesve dhe wipe.
- Çdo rol tjetër (p.sh. `ROLE-USER`) — lexim/shkrim i gjendjes, pa administrim.
- Shembull krijimi (si admin):
  ```bash
  curl -X POST $API/api/admin/users -H "Authorization: Bearer $TOK" \
    -H 'Content-Type: application/json' \
    -d '{"username":"punetor","password":"...8+...","name":"Emer","role":"ROLE-USER"}'
  ```
- Admini i fundit aktiv nuk mund të çaktivizohet (mbrojtje nga lockout-i).
- Ndryshimi i passwordit / çaktivizimi i heq sesionet aktive përdoruesit.

## Kontrollet e serverit (guardrails)

Çdo `PUT /api/state` kalon `validateState.js` dhe refuzohet me **400** nëse:
forma nuk është objekt i vlefshëm, mungojnë fushat e njohura (min 3),
ka ID duplikate, **lot/peshim me neto negative** ose pagesë me shumë ≤ 0.

## Konkurrenca (dy përdorues njëkohësisht)

Gjendja ka **version**. `PUT` me `baseVersion` të vjetër kthen **409** — shkrimi
i dytë nuk e mbishkruan të parin. Aplikacioni hap dritaren e konfliktit:
"Merr nga serveri" / "Shkarko kopjen + Merr serverin" / "Mbaj të miat" (mbishkrim i qëllimshëm).

## Migrimet (pa humbur të dhëna)

Skema mbahet në `migrations/NNN_pershkrim.sql` dhe aplikohet automatikisht në boot:
vetëm file-t e rinj, secili brenda transaksionit, të regjistruar në `schema_migrations`.
Për ndryshim të ri: shto `migrations/003_....sql` me `IF NOT EXISTS` /
`ADD COLUMN IF NOT EXISTS` — kurrë `DROP` mbi tabela me të dhëna.

## Kalimi i të dhënave ekzistuese + backup/restore

**Import i backup-it të aplikacionit në Postgres:**
```bash
API_URL=https://... ADMIN_USER=admin ADMIN_PASS=... npm run import -- BioBes-backup-2026-09-08.json
```
Refuzon nëse serveri ka version më të ri (shto `--force` për mbishkrim të qëllimshëm).

**Eksport nga serveri (format backup-i, rihapet edhe me Import ⇧ në aplikacion):**
```bash
API_URL=https://... ADMIN_USER=admin ADMIN_PASS=... npm run export -- server-backup.json
```

**Fotot dhe PDF-të:** fotot ruhen brenda gjendjes (dataURL) → përfshihen automatikisht
në çdo backup të mësipërm (kufi 25 MB). PDF-të gjenerohen në momentin e printimit,
nuk ruhen — nuk kërkojnë backup.

**Procedura e rekomanduar:**
1. Ditore automatike: backup-et e Aiven-it (point-in-time recovery nga paneli).
2. Para ndryshimeve të mëdha: `npm run export` + `pg_dump "$DATABASE_URL" > dump.sql`.
3. Rikthim i shpejtë në nivel aplikacioni: `npm run import -- file.json` (ose Import ⇧ në aplikacion).
4. Rikthim katastrofik: restore i Aiven-it ose `psql "$DATABASE_URL" < dump.sql`.

## Prova testimi

```bash
API_URL=https://... ADMIN_USER=admin ADMIN_PASS=... npm run test:live
```
12 kontrolle: login 401/ok, shkrim me version, **lexim cross-device** (klient i dytë),
**409 në shkrim të vjetëruar**, guardrails 400, wipe 401/ok, admini mbijeton, audit.
**KUJDES:** testi bën WIPE në fund — vetëm në mjedis testimi!
Qëndrueshmëria pas rinisjes: rinisni servisin në Render → `GET /api/state` kthen të njëjtin version.

## Testim lokal

```bash
cd backend
npm install
cp .env.example .env   # plotëso DATABASE_URL (lokal ose Aiven)
node server.js
curl localhost:3000/api/health
```

## Skema e databazës

`migrations/001_initial.sql`: `users`, `sessions` (hash sha256 + skadim),
`app_state` (rreshti `main`: JSONB + version), `audit_log` (+ `schema_migrations` nga runner-i).

## Hapa pas-live (opsional)

- `CORS_ORIGIN` = domain-i ekzakt i aplikacionit (nga `*`).
- Domain personal: Render → Custom Domain te të dy serviset.
- Plan me pagesë për API-n nëse "gjumi" i planit falas pengon.
