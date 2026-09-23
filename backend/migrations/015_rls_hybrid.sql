-- 015_rls_hybrid — Bashkimi i dy politikave RLS (010_cloud_production + 010_rls).
--
-- Problem që zgjidh ky migrim
-- ---------------------------
-- 010_rls.sql vendos politika të ashpra: pa kontekst (`app.company_id` i
-- vendosur brenda transaksionit) nuk shihet ASNJË rresht. Por shërbimi ka
-- dhjetëra rrugë që pyesin direkt me `pool.query(...)` pa kontekst:
--   * `/api/auth/login`  → `SELECT * FROM users WHERE username=$1`
--   * lista e kompanive → `SELECT * FROM companies`
--   * anëtarësia         → `SELECT … FROM user_companies WHERE user_id=$1`
-- Me politika të ashpra, këto kthejnë zero rreshta dhe **asnjë nuk hyn më**,
-- vetëm se testet lokale nuk e kapin sepse PGlite lidhet si superuser
-- (RLS anashkalohet). Në Aiven `avnadmin` nuk është superuser, ndaj dështimi
-- do të shfaqej vetëm në prodhim.
--
-- Zgjidhja: politika HIBRIDE, e njëjta për të dyja anët
-- -----------------------------------------------------
--   • kur konteksti është vendosur  → izolimi i plotë (vetëm kompania aktive,
--     vetëm anëtarët e saj, superadmini kalon) — kjo është rruga e CRUD-it
--     (`db.withCompany` → `lib/pgCompany.js`);
--   • kur konteksti NUK është vendosur → lejohet, që rrugët ekzistuese
--     (login, lista e kompanive, anëtarësia, backup) të vazhdojnë punë si më parë.
--
-- Kjo nuk është dobësi: rrugët pa kontekst janë të njëjtat që ekzistonin para
-- RLS-së dhe filtrojnë me `WHERE company_id=$1` në kod; ajo që shtohet tani
-- është se rruga e CRUD-it — ajo që shkruajnë të dhënat — nuk varet më nga
-- një `WHERE` i shenuar mirë.
--
-- Plus: një burim i vetëm i së vërtetës për anëtarësi. 010_rls krijon tabelën
-- `company_users`, ndërsa i gjithë kodi i aplikacionit lexon `user_companies`.
-- Dy tabela = dy burime që shmangen. Këtu `company_users` bëhet **pamje**
-- (view) mbi `user_companies`, kështu që të dyja emrat punojnë.

-- ============ 0) user_companies: jashtë RLS-së =============================
-- Kjo është tabela e anëtarësisë dhe lexohet BRENDA politikave (app_is_member →
-- company_users → user_companies). Nëse i vendoset RLS, politikat kërkojnë
-- vetë vetën dhe Postgres-i hedh gabim rekursioni. Nuk përmban të dhëna biznesi,
-- vetëm çiftet (kompani, përdorues).
DO $$
BEGIN
  IF to_regclass('public.user_companies') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.user_companies DISABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS user_companies_company_isolation ON public.user_companies';
  END IF;
END $$;

-- ============ 1) company_users → pamje mbi user_companies ==================
DO $$
BEGIN
  IF to_regclass('public.company_users') IS NOT NULL
     AND (SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relname='company_users') = 'r' THEN
    EXECUTE 'DROP TABLE public.company_users CASCADE';
  END IF;
END $$;

CREATE OR REPLACE VIEW public.company_users AS
  SELECT company_id, user_id, is_default, NULL::text AS role_in_company, NOW() AS created_at
    FROM public.user_companies;

-- ============ 2) Politika hibrid për çdo tabelë me company_id ===============
DO $$
DECLARE
  r RECORD;
  v_using text;
  v_check text;
BEGIN
  FOR r IN
    SELECT c.table_name, c.is_nullable
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'company_id'
       AND t.table_type = 'BASE TABLE'
       AND c.table_name NOT IN ('companies', 'company_users', 'user_companies')
     ORDER BY c.table_name
  LOOP
    -- RLS aktivizohet edhe për tabelat e krijuara pas 010 (p.sh. rate_buckets
    -- s'ka company_id, por audit_log ka — kjo mbulon edhe të ardhmen).
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.table_name);

    v_using :=
        '(public.app_company_id() IS NULL)'                                          -- rrugë të vjetra (login, listime, backup)
     || ' OR public.app_is_superadmin()'                                             -- sistem
     || ' OR (company_id = public.app_company_id() AND public.app_is_member(public.app_company_id()))'  -- anëtar i kompanisë aktive
     || ' OR (company_id IS NULL AND public.app_is_superadmin())';                   -- rreshta pa kompani (audit_log i vjetër)
    v_check :=
        '(public.app_company_id() IS NULL OR public.app_is_superadmin() OR company_id = public.app_company_id())';

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.table_name || '_company_isolation', r.table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO PUBLIC USING (%s) WITH CHECK (%s)',
                   r.table_name || '_company_isolation', r.table_name, v_using, v_check);
  END LOOP;
END $$;

-- ============ 3) companies: anëtarët, ose pa kontekst (rrugë të vjetra) ======
DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN RETURN; END IF;
  EXECUTE 'ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.companies FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS companies_membership ON public.companies';
  EXECUTE $pol$
    CREATE POLICY companies_membership ON public.companies AS PERMISSIVE FOR ALL TO PUBLIC
      USING (
        public.app_company_id() IS NULL
        OR public.app_is_superadmin()
        OR EXISTS (SELECT 1 FROM public.user_companies cu
                    WHERE cu.company_id = companies.id AND cu.user_id = public.app_user_id())
      )
      WITH CHECK (public.app_company_id() IS NULL OR public.app_is_superadmin())
  $pol$;
END $$;

-- ============ 4) users: vetja + bashkëpunëtorët, ose pa kontekst ============
-- Pa këtë, `/api/auth/login` (i cili pyet pa kontekst) nuk do të gjente asnjë
-- përdorues dhe asnjë nuk do të hynte.
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN RETURN; END IF;
  EXECUTE 'ALTER TABLE public.users ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.users FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS users_scope ON public.users';
  EXECUTE $pol$
    CREATE POLICY users_scope ON public.users AS PERMISSIVE FOR ALL TO PUBLIC
      USING (
        public.app_user_id() IS NULL
        OR public.app_is_superadmin()
        OR id = public.app_user_id()
        OR EXISTS (SELECT 1 FROM public.user_companies cu
                    WHERE cu.user_id = users.id AND cu.company_id = public.app_company_id())
      )
      WITH CHECK (public.app_user_id() IS NULL OR public.app_is_superadmin() OR id = public.app_user_id())
  $pol$;
END $$;

-- ============ 5) Verifikim ==================================================
DO $$
DECLARE n int; s int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public';
  SELECT count(*) INTO s FROM pg_class c JOIN pg_namespace m ON m.oid = c.relnamespace
   WHERE c.relkind = 'r' AND c.relrowsecurity AND m.nspname = 'public';
  RAISE NOTICE '015_rls_hybrid: % politika RLS, % tabela me RLS aktiv', n, s;
END $$;
