-- 011_doc_sequences — Numërim i dokumenteve me bllokim rreshti (SELECT … FOR UPDATE).
-- Zgjidh garën reale: dy pajisje (nga 20 përdorues) krijojnë dokument të të njëjtit lloj
-- në të njëjtin çast. Pa këtë, të dyja llogarisin «numrin e radhës» nga lista vendore dhe
-- nxjerrin të njëjtin numër. Këtu numri merret nga një rresht i vetëm i bllokuar për
-- (company_id, kind, period) → transaksioni i dytë PRET dhe merr numrin tjetër.
--
-- Përdorimi: backend/lib/sequences.js → nextNumber(client, companyId, kind, { period })
-- (client duhet të jetë brenda transaksionit të hapur nga lib/pgCompany.js).

CREATE TABLE IF NOT EXISTS doc_sequences (
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,              -- 'sales_invoice' | 'purchase_invoice' | 'stock_in' | 'stock_out' | 'sample' | 'order' | 'shipment' | 'return'
  period      TEXT NOT NULL DEFAULT '',   -- '' (gjithnjë) | '2026' (vjetor) | '2026-09' (mujor)
  last_number BIGINT NOT NULL DEFAULT 0,
  prefix      TEXT NOT NULL DEFAULT '',   -- p.sh. 'FSH', 'FBL', 'FH', 'FD' (opsional: mbishkruan paraprakësimin e kodit)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (company_id, kind, period)
);

ALTER TABLE doc_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_sequences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doc_sequences_company_isolation ON doc_sequences;
CREATE POLICY doc_sequences_company_isolation ON doc_sequences
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (company_id = public.app_company_id() OR public.app_is_superadmin())
  WITH CHECK (company_id = public.app_company_id() OR public.app_is_superadmin());

CREATE INDEX IF NOT EXISTS doc_sequences_company_kind_idx ON doc_sequences (company_id, kind);

-- Regjistër i numrave të lëshuar (për auditim dhe për zbulim të përplasjeve 409).
CREATE TABLE IF NOT EXISTS doc_numbers_used (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  number     TEXT NOT NULL,
  table_name TEXT NOT NULL DEFAULT '',
  doc_id     TEXT NOT NULL DEFAULT '',
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, kind, number)
);

ALTER TABLE doc_numbers_used ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_numbers_used FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doc_numbers_used_company_isolation ON doc_numbers_used;
CREATE POLICY doc_numbers_used_company_isolation ON doc_numbers_used
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (company_id = public.app_company_id() OR public.app_is_superadmin())
  WITH CHECK (company_id = public.app_company_id() OR public.app_is_superadmin());
