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
