-- 007_multi_company — Skema relacionale për shumë kompani (izolim i plotë).
-- Krijohen tabelat e biznesit në vend të një JSONB të vetëm, me `company_id`
-- në çdo tabelë, që asnjë e dhënë e një kompanie të mos përzihet me tjetrën.
-- Tabela e vjetër app_state mbahet për prapapajtueshmëri me klientët e vjetër,
-- por rekomandohet të migrohen në CRUD.

-- Kompanitë
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tax_id TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'ALL',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lidhja user <-> kompani (një user mund t'i përkasë shumë kompanive; një kompani shumë userave)
CREATE TABLE IF NOT EXISTS company_users (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_company TEXT NOT NULL DEFAULT 'user', -- 'owner' | 'admin' | 'manager' | 'user'
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS company_users_user_idx ON company_users(user_id);

-- Shtojmë company_id në përdorues (për superadmin global, user pa kompani; user-at me role 'ROLE-ADMIN'
-- pa kompani janë superadmina që menaxhojnë platformën).
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT FALSE;

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

-- Shtojmë kolona `company_id` në tabelat ekzistuese (audit, sessions) për filtrim,
-- por vlerat e vjetra mbeten NULL (përputhshmëri).
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS company_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS company_id TEXT;

-- Tabela për session-aktive (e dimë në cilën kompani është aktualisht useri).
CREATE TABLE IF NOT EXISTS user_sessions_active (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Shenja e wipe-it TANI për çdo kompani (nuk është më globale).
CREATE TABLE IF NOT EXISTS company_wipe_epoch (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  wiped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  wiped_by TEXT NOT NULL DEFAULT ''
);

-- Regjistër për sinkronizim realtime (version monotonik për kompani).
CREATE TABLE IF NOT EXISTS company_sync (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
