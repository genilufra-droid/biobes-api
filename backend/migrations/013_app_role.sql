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
