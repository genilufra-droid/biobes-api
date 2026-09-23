-- 009_company_domain — Tabelat relacionale të biznesit për kompani (izolim me company_id).
--
-- KY MIGRIM ËSHTË RIFORMULUAR GJATË BASHKIMIT TË DEGËS arena/01a0be23-biobes-api NË main.
-- Versioni origjinal i degës ishte 007_multi_company.sql, por main e ka zënë numrin 007
-- (007_backups.sql) dhe ka sjellë vetë modelin multi-company në 008_companies.sql.
-- Prandaj:
--   * numri i ri është 009 (zbatohet pas 008);
--   * HIQEN krijimet e tabelave companies dhe company_users — main i krijon në 008 si
--     companies / user_companies (me code, nipt, country, vat_rate);
--   * HIQEN ALTER sessions.company_id dhe user_sessions_active — nuk përdoren nga
--     kodi i bashkuar (gjurmimi i sesionit aktiv nuk ekziston as në main, as në degë);
--   * users.is_superadmin MBETET: e përdor auth.js i bashkuar (një user jo
--     ROLE-ADMIN mund të shpallet superadmin) dhe ensureAdmin e vendos TRUE;
--   * company_wipe_epoch MBETET: shënon pastrimin e të dhënave relacionale të një
--     kompanie (/api/admin/company/:id/wipe) dhe është i ndarë nga shenjat e
--     wipe-it të app_state që companies.js i mban në tabelën meta;
--   * HIQET ALTER audit_log.company_id — e shton tashmë 008_companies.sql;
--   * SHTOHEN vetëm kolonat që modeli i degës kishte dhe 008 nuk i ka:
--     companies.phone, companies.email, companies.settings, companies.updated_at
--     (tax_id e degës përputhet me companies.nipt të main-it).
-- Gjithçka tjetër (tabelat e biznesit + company_sync) vjen e pandryshuar nga dega.

-- Flamuri i superadmin-it (auth.js: is_superuser = role ROLE-ADMIN ose kjo kolonë).
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT FALSE;

-- Kolona shtesë në companies, të trashëguara nga modeli i degës.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Tabelat e biznesit (me company_id për izolim).
-- Çdo tabelë ka PK `(company_id, id)` për indeksim e izolim perfekt.

-- Produktet
CREATE TABLE IF NOT EXISTS products (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'copë',
  category TEXT NOT NULL DEFAULT '',
  price NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance NUMERIC(14,3) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS products_code_idx ON products(company_id, code);
CREATE INDEX IF NOT EXISTS products_name_idx ON products(company_id, LOWER(name));

-- Furnitorët
CREATE TABLE IF NOT EXISTS suppliers (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  tax_id TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS suppliers_code_idx ON suppliers(company_id, code);

-- Klientët
CREATE TABLE IF NOT EXISTS customers (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  tax_id TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS customers_code_idx ON customers(company_id, code);

-- Magazinat
CREATE TABLE IF NOT EXISTS warehouses (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);

-- Lotet (gjurmueshmëria)
CREATE TABLE IF NOT EXISTS lots (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL DEFAULT '',
  lot_number TEXT NOT NULL DEFAULT '',
  net NUMERIC(14,3) NOT NULL DEFAULT 0,
  tare NUMERIC(14,3) NOT NULL DEFAULT 0,
  gross NUMERIC(14,3) NOT NULL DEFAULT 0,
  produced_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS lots_product_idx ON lots(company_id, product_id);

-- Peshimet
CREATE TABLE IF NOT EXISTS weighings (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  lot_id TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL DEFAULT '',
  supplier_id TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'in', -- 'in' | 'out'
  net NUMERIC(14,3) NOT NULL DEFAULT 0,
  tare NUMERIC(14,3) NOT NULL DEFAULT 0,
  gross NUMERIC(14,3) NOT NULL DEFAULT 0,
  price NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  operator TEXT NOT NULL DEFAULT '',
  weighed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS weighings_weighed_at_idx ON weighings(company_id, weighed_at DESC);
CREATE INDEX IF NOT EXISTS weighings_product_idx ON weighings(company_id, product_id);

-- Pagesat (furnitorët)
CREATE TABLE IF NOT EXISTS payments (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS payments_paid_idx ON payments(company_id, paid_at DESC);

-- Arkëtime (klientët)
CREATE TABLE IF NOT EXISTS customer_payments (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS customer_payments_paid_idx ON customer_payments(company_id, paid_at DESC);

-- Fatura shitjeje
CREATE TABLE IF NOT EXISTS sales_invoices (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  number TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL DEFAULT '',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS sales_invoices_number_idx ON sales_invoices(company_id, number);
CREATE INDEX IF NOT EXISTS sales_invoices_customer_idx ON sales_invoices(company_id, customer_id);

-- Fatura blerjeje
CREATE TABLE IF NOT EXISTS purchase_invoices (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  number TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL DEFAULT '',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS purchase_invoices_number_idx ON purchase_invoices(company_id, number);

-- Regjistër për sinkronizim realtime (version monotonik për kompani).
CREATE TABLE IF NOT EXISTS company_sync (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Shenja e wipe-it relacional për çdo kompani (pastrimi i tabelave të biznesit).
CREATE TABLE IF NOT EXISTS company_wipe_epoch (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  wiped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  wiped_by TEXT NOT NULL DEFAULT ''
);
