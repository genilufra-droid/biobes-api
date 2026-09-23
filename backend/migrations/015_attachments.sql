-- 015_attachments — Ruajtje e skedarëve binarë (foto peshimi, fatura, PDF) jashtë app_state JSON.
-- Arkitekturë Enterprise Cloud (si Odoo/QuickBooks): fotot dhe dokumentet ruhen si
-- skedarë binarë të dedikuar me caching dhe RLS, duke e mbajtur JSON-in e gjendjes
-- të lehtë (< 500 KB) dhe duke parandaluar bllokimin e kufirit 25 MB.

CREATE TABLE IF NOT EXISTS attachments (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INT NOT NULL DEFAULT 0,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);

CREATE INDEX IF NOT EXISTS attachments_company_idx ON attachments(company_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'biobes_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON attachments TO biobes_app;
  END IF;
END $$;

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attachments_company_isolation ON attachments;
CREATE POLICY attachments_company_isolation ON attachments
  FOR ALL
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')
    OR current_setting('app.is_superadmin', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')
    OR current_setting('app.is_superadmin', true) = 'true'
  );
