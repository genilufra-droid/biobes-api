-- 002_audit_index — indeks për lexim të shpejtë të auditit (pa prekur të dhënat).
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log(at DESC);
