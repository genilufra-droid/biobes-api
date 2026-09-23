-- 008_companies — Multi-company (Modeli B): kompanitë, gjendja per kompani,
-- anëtarësia e përdoruesve, backup/audit/wipe per kompani.
--
-- SKEMA PARA:  app_state ka NJË rresht me id='main'.
-- SKEMA PAS:   app_state ka nga një rresht per kompani, me id = ID e kompanisë
--              ('C1', 'C2', …) dhe kolonën company_id. Kështu PK-ja ekzistuese
--              (id) vazhdon të mbahet dhe ON CONFLICT(id) punon pa ndryshim.
--
-- Kjo migrim NUK humb të dhëna dhe është idempotente (mund të ekzekutohet disa herë):
-- gjendja ekzistuese kalon e paprekur në kompaninë e parë (C1), të gjithë përdoruesit
-- ekzistues bëhen anëtarë të C1 me C1 si kompani të parazgjedhur, backup-et dhe
-- zërat e auditimit shenjohen me C1.

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  nipt TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'AL',
  vat_rate NUMERIC(5,2) NOT NULL DEFAULT 20,
  currency TEXT NOT NULL DEFAULT 'ALL',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO companies(id,code,name) VALUES('C1','BB','BioBes') ON CONFLICT (id) DO NOTHING;

-- Kopje sigurie e skemës së vjetër (rollback): krijohet PARA ndryshimit.
CREATE TABLE IF NOT EXISTS app_state_bak_008 AS SELECT * FROM app_state;

-- Gjendja ekzistuese → kompania e parë.
ALTER TABLE app_state ADD COLUMN IF NOT EXISTS company_id TEXT;
UPDATE app_state SET id='C1' WHERE id='main';
UPDATE app_state SET company_id=id WHERE company_id IS NULL;
ALTER TABLE app_state ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS app_state_company_idx ON app_state(company_id);

-- Anëtarësia: kush punon në cilën kompani (dhe kompania e parazgjedhur).
CREATE TABLE IF NOT EXISTS user_companies (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, company_id)
);
CREATE INDEX IF NOT EXISTS user_companies_company_idx ON user_companies(company_id);

INSERT INTO user_companies(user_id,company_id,is_default)
  SELECT u.id,'C1',TRUE FROM users u ON CONFLICT DO NOTHING;

-- Backup-et, auditimi dhe (për fazën tjetër) grupet: per kompani.
ALTER TABLE backups ADD COLUMN IF NOT EXISTS company_id TEXT;
UPDATE backups SET company_id='C1' WHERE company_id IS NULL;
CREATE INDEX IF NOT EXISTS backups_company_idx ON backups(company_id);

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS company_id TEXT;
UPDATE audit_log SET company_id='C1' WHERE company_id IS NULL;
CREATE INDEX IF NOT EXISTS audit_log_company_idx ON audit_log(company_id);

ALTER TABLE user_groups ADD COLUMN IF NOT EXISTS company_id TEXT;

-- Epoka e wipe-it (Reset i plotë) ndahet per kompani: 'wiped_at:C1'.
UPDATE meta SET key='wiped_at:C1'
  WHERE key='wiped_at' AND NOT EXISTS (SELECT 1 FROM meta m2 WHERE m2.key='wiped_at:C1');
