-- 010_cloud_production — Baza për prodhim shumë-kompani.
--
-- Sjell pesë gjëra që e çojnë sistemin nga "funksionon në cloud" në
-- "i qëndrueshëm në cloud me shumë kompani":
--
--   1. fshirje e butë (tombstones): pajisjet e tjera mësojnë ÇFARË u fshi;
--   2. version për rresht + indekse unike: asnjë mbishkrim i heshtur;
--   3. RLS (Row Level Security): izolimi zbatohet nga Postgres-i vetë, edhe
--      nëse një rresht kodi harron filtrin WHERE company_id = …;
--   4. rate_buckets: kufizuesi i kërkesave vlen për të gjitha instancat;
--   5. indekse për sinkronizim sipas kohe (?since=).
--
-- Asgjë këtu nuk fshin të dhëna: vetëm ALTER TABLE ADD COLUMN IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS dhe aktivizim politikash.

-- ============ 1. FSHIRJE E BUTË (tombstones) ================================
-- Një rresht i fshirë mbetet në tabelë me deleted_at të vendosur, kështu që
-- pajisja që ishte offline e merr ndryshimin me ?since= në vend që ta mbajë
-- rreshtin si "fantazmë" në cache-n e vet.
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE lots ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE weighings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ============ 2. VERSION PËR RRESHT + UNICITET ==============================
-- version rritet në çdo përditësim; klienti që dërgon version të vjetër merr
-- 409 në vend që të mbishkruajë pa e ditur (konflikt i dy pajisjeve).
ALTER TABLE products ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE lots ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE weighings ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;

-- Kodi unik brenda kompanisë (produkte, palë, magazina) dhe numri unik i
-- faturës. Pjesshme: llogariten vetëm rreshtat e gjallë, që një kod i liruar
-- nga një fshirje të mund të ripërdoret.
CREATE UNIQUE INDEX IF NOT EXISTS products_code_uniq ON products(company_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_code_uniq ON suppliers(company_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customers_code_uniq ON customers(company_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_code_uniq ON warehouses(company_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_invoices_number_uniq ON sales_invoices(company_id, number) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoices_number_uniq ON purchase_invoices(company_id, number) WHERE deleted_at IS NULL;

-- Sinkronizimi sipas kohës (?since=ISO) dhe pastrimi i tombstone-ve.
CREATE INDEX IF NOT EXISTS products_updated_idx ON products(company_id, updated_at);
CREATE INDEX IF NOT EXISTS suppliers_updated_idx ON suppliers(company_id, updated_at);
CREATE INDEX IF NOT EXISTS customers_updated_idx ON customers(company_id, updated_at);
CREATE INDEX IF NOT EXISTS warehouses_updated_idx ON warehouses(company_id, updated_at);
CREATE INDEX IF NOT EXISTS lots_updated_idx ON lots(company_id, updated_at);
CREATE INDEX IF NOT EXISTS weighings_updated_idx ON weighings(company_id, updated_at);
CREATE INDEX IF NOT EXISTS payments_updated_idx ON payments(company_id, updated_at);
CREATE INDEX IF NOT EXISTS customer_payments_updated_idx ON customer_payments(company_id, updated_at);
CREATE INDEX IF NOT EXISTS sales_invoices_updated_idx ON sales_invoices(company_id, updated_at);
CREATE INDEX IF NOT EXISTS purchase_invoices_updated_idx ON purchase_invoices(company_id, updated_at);

-- ============ 3. RLS — IZOLIMI NË DATABAZË =================================
-- Deri tani izolimi varej vetëm nga kodi (një WHERE i harruar = të dhëna të
-- kompanisë tjetër). Me RLS, Postgres-i e refuzon vetë.
--
-- Konteksti vendoset nga aplikacioni me:
--   BEGIN; SELECT set_config('app.company_id', 'C2', true); …; COMMIT;
-- Kur konteksti nuk është vendosur (rrugë të vjetra, skripte, migrime),
-- politika lejon — kështu aktivizimi është pa rrezik dhe pa ndërprerje.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'products','suppliers','customers','warehouses','lots','weighings',
    'payments','customer_payments','sales_invoices','purchase_invoices',
    'app_state','backups'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      -- FORCE: politika zbatohet edhe për pronarin e tabelës (në Aiven lidhja
      -- është pronare, përndryshe RLS do të ishte vetëm dekorative).
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_company_isolation', t);
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (current_setting(''app.company_id'', true) IS NULL OR company_id = current_setting(''app.company_id'', true)) WITH CHECK (current_setting(''app.company_id'', true) IS NULL OR company_id = current_setting(''app.company_id'', true))',
        t || '_company_isolation', t);
    END IF;
  END LOOP;
END $$;

-- ============ 4. KUFIZUESI I KËRKESAVE NË DATABAZË ==========================
-- Përdoret kur MULTI_INSTANCE=1, që kufiri të jetë një për të gjitha instancat.
CREATE TABLE IF NOT EXISTS rate_buckets (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_buckets_reset_idx ON rate_buckets(reset_at);
