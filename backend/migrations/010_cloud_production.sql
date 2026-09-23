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

-- (Izolimi RLS e mbulojnë 010_rls.sql dhe 015_rls_hybrid.sql më poshtë.)

-- ============ 4. KUFIZUESI I KËRKESAVE NË DATABAZË ==========================
-- Përdoret kur MULTI_INSTANCE=1, që kufiri të jetë një për të gjitha instancat.
CREATE TABLE IF NOT EXISTS rate_buckets (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_buckets_reset_idx ON rate_buckets(reset_at);
