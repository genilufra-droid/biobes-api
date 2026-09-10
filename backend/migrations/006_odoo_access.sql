-- 006_odoo_access — Skema e qasjes sipas modelit Odoo.
-- Harta e koncepteve Odoo -> tabelat tona:
--   ir.module.category (Aplikacionet)     -> access_modules
--   res.groups (grupet e qasjes)          -> access_groups  (me implied_group_ids si `implied_ids` i Odoo-s)
--   ir.model.access (CRUD per model/grup) -> access_rights
--   ir.rule (rregullat e regjistrimeve)   -> access_rules   (domain JSONB si `domain_force`)
--   res.groups <-> res.users (M2M)        -> user_groups
-- Tabela `users` ekziston nga migrimi 001; roli ROLE-ADMIN vazhdon si bypass i plotë.

CREATE TABLE IF NOT EXISTS access_modules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  technical_name TEXT UNIQUE NOT NULL,
  sequence INT NOT NULL DEFAULT 10
);

CREATE TABLE IF NOT EXISTS access_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  full_name TEXT UNIQUE NOT NULL,
  module_id TEXT NOT NULL REFERENCES access_modules(id) ON DELETE CASCADE,
  comment TEXT NOT NULL DEFAULT '',
  implied_group_ids JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS access_rights (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
  perm_read BOOLEAN NOT NULL DEFAULT FALSE,
  perm_write BOOLEAN NOT NULL DEFAULT FALSE,
  perm_create BOOLEAN NOT NULL DEFAULT FALSE,
  perm_unlink BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (model, group_id)
);

CREATE TABLE IF NOT EXISTS access_rules (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  domain JSONB NOT NULL DEFAULT '{}'::jsonb,
  perm_read BOOLEAN NOT NULL DEFAULT FALSE,
  perm_write BOOLEAN NOT NULL DEFAULT FALSE,
  perm_create BOOLEAN NOT NULL DEFAULT FALSE,
  perm_unlink BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS user_groups (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);
CREATE INDEX IF NOT EXISTS user_groups_group_idx ON user_groups(group_id);

-- ===== SEED: modulet (aplikacionet) e BioBes ==================================
INSERT INTO access_modules(id,name,technical_name,sequence) VALUES
  ('MOD-INV','Inventari','inventory',10),
  ('MOD-SAL','Shitjet','sales',20),
  ('MOD-PUR','Blerjet','purchases',30),
  ('MOD-FIN','Financa','finance',40),
  ('MOD-SET','Administrimi','settings',50)
ON CONFLICT (id) DO NOTHING;

-- ===== SEED: grupet (si res.groups; full_name = "Moduli / Grupi") ==============
INSERT INTO access_groups(id,name,full_name,module_id,comment,implied_group_ids) VALUES
  ('GRP-SET-ADMIN','Administrator','Administrimi / Administrator','MOD-SET','Qasje e plotë — nënkupton të gjitha grupet.', '["GRP-SET-USER","GRP-INV-USER","GRP-INV-MGR","GRP-SAL-USER","GRP-SAL-MGR","GRP-PUR-USER","GRP-PUR-MGR","GRP-FIN-USER","GRP-FIN-MGR"]'::jsonb),
  ('GRP-SET-USER','Përdorues','Administrimi / Përdorues','MOD-SET','Shikon përdoruesit lokalë të aplikacionit.', '[]'::jsonb),
  ('GRP-INV-USER','Përdorues','Inventari / Përdorues','MOD-INV','Regjistron produkte, magazina, lote dhe peshime.', '[]'::jsonb),
  ('GRP-INV-MGR','Menaxher','Inventari / Menaxher','MOD-INV','Kontroll i plotë i inventarit.', '["GRP-INV-USER"]'::jsonb),
  ('GRP-SAL-USER','Përdorues','Shitjet / Përdorues','MOD-SAL','Klientë, fatura shitjeje, porosi.', '[]'::jsonb),
  ('GRP-SAL-MGR','Menaxher','Shitjet / Menaxher','MOD-SAL','Kontroll i plotë i shitjeve.', '["GRP-SAL-USER"]'::jsonb),
  ('GRP-PUR-USER','Përdorues','Blerjet / Përdorues','MOD-PUR','Furnitorë dhe fatura blerjeje.', '[]'::jsonb),
  ('GRP-PUR-MGR','Menaxher','Blerjet / Menaxher','MOD-PUR','Kontroll i plotë i blerjeve.', '["GRP-PUR-USER"]'::jsonb),
  ('GRP-FIN-USER','Përdorues','Financa / Përdorues','MOD-FIN','Pagesat.', '[]'::jsonb),
  ('GRP-FIN-MGR','Menaxher','Financa / Menaxher','MOD-FIN','Kontroll i plotë i financës.', '["GRP-FIN-USER"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ===== SEED: të drejtat e modeleve (si ir.model.access) ========================
-- Modelet që njihen nga API: app_state (gjendja ERP), audit, users, access.
INSERT INTO access_rights(id,model,group_id,perm_read,perm_write,perm_create,perm_unlink) VALUES
  -- Administrator: gjithçka.
  ('ACC-SET-ADM-STATE','app_state','GRP-SET-ADMIN',TRUE,TRUE,TRUE,TRUE),
  ('ACC-SET-ADM-AUDIT','audit','GRP-SET-ADMIN',TRUE,FALSE,FALSE,FALSE),
  ('ACC-SET-ADM-USERS','users','GRP-SET-ADMIN',TRUE,TRUE,TRUE,TRUE),
  ('ACC-SET-ADM-ACCESS','access','GRP-SET-ADMIN',TRUE,TRUE,FALSE,FALSE),
  -- Përdoruesit/menaxherët e moduleve: lexojnë e shkruajnë gjendjen e moduleve të tyre.
  ('ACC-SET-USR-STATE','app_state','GRP-SET-USER',TRUE,TRUE,FALSE,FALSE),
  ('ACC-INV-USR-STATE','app_state','GRP-INV-USER',TRUE,TRUE,FALSE,FALSE),
  ('ACC-INV-MGR-STATE','app_state','GRP-INV-MGR',TRUE,TRUE,FALSE,FALSE),
  ('ACC-SAL-USR-STATE','app_state','GRP-SAL-USER',TRUE,TRUE,FALSE,FALSE),
  ('ACC-SAL-MGR-STATE','app_state','GRP-SAL-MGR',TRUE,TRUE,FALSE,FALSE),
  ('ACC-PUR-USR-STATE','app_state','GRP-PUR-USER',TRUE,TRUE,FALSE,FALSE),
  ('ACC-PUR-MGR-STATE','app_state','GRP-PUR-MGR',TRUE,TRUE,FALSE,FALSE),
  ('ACC-FIN-USR-STATE','app_state','GRP-FIN-USER',TRUE,TRUE,FALSE,FALSE),
  ('ACC-FIN-MGR-STATE','app_state','GRP-FIN-MGR',TRUE,TRUE,FALSE,FALSE)
ON CONFLICT (id) DO NOTHING;

-- ===== SEED: administratorët ekzistues (ROLE-ADMIN) futen në grupin Administrator =====
INSERT INTO user_groups(user_id, group_id)
  SELECT id, 'GRP-SET-ADMIN' FROM users WHERE role='ROLE-ADMIN'
ON CONFLICT DO NOTHING;
