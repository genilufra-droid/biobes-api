-- 010_p3_indexes — Indekset e performancës për 20 përdorues konkurrent + unikitet
-- i numrave të dokumenteve për kompani (mbështet lib/sequences.js me FOR UPDATE).
--
-- Idempotent DHE tolerant ndaj bazës: çdo indeks krijohet vetëm nëse tabela dhe të
-- gjitha kolonat e tij ekzistojnë. Kjo do të thotë se migrimi nuk dështon as në një
-- bazë të vjetër (para 007), as në një bazë ku disa module nuk janë aktivizuar.

-- ========== 1) Numrat e dokumenteve: unikë për (company_id, number) ==========
-- Pa këtë, dy pajisje mund të ruajnë të njëjtin numër. Krijohet si UNIQUE vetëm
-- nëse nuk ka dublikata; përndryshe mbetet indeks i thjeshtë dhe jepet WARNING
-- (dublikatat duhen pastruar para kalimit në UNIQUE).
DO $$
DECLARE
  t text;
  d int;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_invoices', 'purchase_invoices']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=t AND column_name='number') THEN CONTINUE; END IF;

    EXECUTE format('SELECT count(*) FROM (SELECT company_id, number FROM public.%I
                    GROUP BY 1,2 HAVING count(*) > 1) x', t) INTO d;

    EXECUTE format('DROP INDEX IF EXISTS public.%I_number_idx', t);

    IF d = 0 THEN
      EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I_company_number_uniq ON public.%I (company_id, number)', t, t);
      RAISE NOTICE '010: % → indeks UNIQUE (company_id, number)', t;
    ELSE
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I_company_number_idx ON public.%I (company_id, number)', t, t);
      RAISE WARNING '010: % ka % grupe numrash të dublikuar — UNIQUE nuk u krijua. Pastro dublikatat dhe riapliko migrimin.', t, d;
    END IF;
  END LOOP;
END $$;

-- ========== 2) Të gjitha indekset e tjera (tabela + kolonat kontrollohen) ==========
DO $$
DECLARE
  r RECORD;
  col text;
  v_ok boolean;
  v_created int := 0;
  v_skipped int := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- (emri i indeksit, tabela, kolonat e kërkuara, shprehja e indeksit)
      ('products_company_active_idx',        'products',            ARRAY['company_id','active','name'],        '(company_id, active, LOWER(name))'),
      ('suppliers_company_name_idx',         'suppliers',           ARRAY['company_id','name'],                 '(company_id, LOWER(name))'),
      ('suppliers_company_tax_idx',          'suppliers',           ARRAY['company_id','tax_id'],               '(company_id, tax_id)'),
      ('customers_company_name_idx',         'customers',           ARRAY['company_id','name'],                 '(company_id, LOWER(name))'),
      ('customers_company_tax_idx',          'customers',           ARRAY['company_id','tax_id'],               '(company_id, tax_id)'),
      ('warehouses_company_active_idx',      'warehouses',          ARRAY['company_id','active'],               '(company_id, active)'),
      ('lots_company_lot_number_idx',        'lots',                ARRAY['company_id','lot_number'],           '(company_id, lot_number)'),
      ('lots_company_warehouse_idx',         'lots',                ARRAY['company_id','warehouse_id'],         '(company_id, warehouse_id)'),
      ('weighings_company_supplier_idx',     'weighings',           ARRAY['company_id','supplier_id','weighed_at'], '(company_id, supplier_id, weighed_at DESC)'),
      ('weighings_company_customer_idx',     'weighings',           ARRAY['company_id','customer_id','weighed_at'], '(company_id, customer_id, weighed_at DESC)'),
      ('weighings_company_direction_idx',    'weighings',           ARRAY['company_id','direction','weighed_at'],   '(company_id, direction, weighed_at DESC)'),
      ('weighings_company_lot_idx',          'weighings',           ARRAY['company_id','lot_id'],               '(company_id, lot_id)'),
      ('payments_company_supplier_idx',      'payments',            ARRAY['company_id','supplier_id','paid_at'],    '(company_id, supplier_id, paid_at DESC)'),
      ('customer_payments_company_idx',      'customer_payments',   ARRAY['company_id','customer_id','paid_at'],    '(company_id, customer_id, paid_at DESC)'),
      ('sales_invoices_company_status_idx',  'sales_invoices',      ARRAY['company_id','status','issued_at'],       '(company_id, status, issued_at DESC)'),
      ('sales_invoices_company_issued_idx',  'sales_invoices',      ARRAY['company_id','issued_at'],                '(company_id, issued_at DESC)'),
      ('purchase_invoices_company_status_idx','purchase_invoices',  ARRAY['company_id','status','issued_at'],       '(company_id, status, issued_at DESC)'),
      ('purchase_invoices_company_supplier_idx','purchase_invoices',ARRAY['company_id','supplier_id','issued_at'],  '(company_id, supplier_id, issued_at DESC)'),
      ('company_users_company_idx',          'company_users',       ARRAY['company_id','user_id'],              '(company_id, user_id)'),
      ('company_sync_updated_idx',           'company_sync',        ARRAY['updated_at'],                        '(updated_at DESC)'),
      ('audit_log_company_created_idx',      'audit_log',           ARRAY['company_id','created_at'],           '(company_id, created_at DESC)'),
      ('audit_log_created_idx',              'audit_log',           ARRAY['created_at'],                        '(created_at DESC)'),
      ('sessions_user_idx',                  'sessions',            ARRAY['user_id'],                           '(user_id)'),
      ('user_sessions_active_user_idx',      'user_sessions_active',ARRAY['user_id','company_id'],              '(user_id, company_id)'),
      ('user_sessions_active_seen_idx',      'user_sessions_active',ARRAY['last_seen'],                         '(last_seen DESC)'),
      ('app_state_company_idx',              'app_state',           ARRAY['company_id'],                        '(company_id)')
    ) AS v(idx_name, tbl, cols, expr)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_ok := true;
    FOREACH col IN ARRAY r.cols LOOP
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema='public' AND table_name=r.tbl AND column_name=col) THEN
        v_ok := false;
        EXIT;
      END IF;
    END LOOP;

    IF NOT v_ok THEN
      v_skipped := v_skipped + 1;
      RAISE NOTICE '010: % u anashkalua — tabela % nuk ka të gjitha kolonat', r.idx_name, r.tbl;
      CONTINUE;
    END IF;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I %s', r.idx_name, r.tbl, r.expr);
    v_created := v_created + 1;
  END LOOP;

  RAISE NOTICE '010: % indekse të krijuara/verifikuara, % të anashkaluara (tabela/kolona mungojnë)', v_created, v_skipped;
END $$;

-- ========== 3) Statistika të freskëta për planifikuesin ==========
-- ANALYZE i lehtë vetëm për tabelat që ekzistojnë (jo ANALYZE e plotë, që të mos
-- bllokojë prodhimin gjatë orarit të punës).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','suppliers','customers','warehouses','lots','weighings',
                           'payments','customer_payments','sales_invoices','purchase_invoices',
                           'company_users','company_sync','doc_sequences']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ANALYZE public.%I', t);
    END IF;
  END LOOP;
END $$;
