-- 012_refresh_tokens — Refresh tokenë të ruajtur në server (jo në browser).
-- Access token (15 min) mbetet stateless (JWT HS256); refresh token (7 ditë) është
-- i ruajtur si hash SHA-256 këtu, që të mund të revokohet menjëherë (dalje, ndërrim
-- fjalëkalimi, wipe kompanie) pa pritur skadencën.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           TEXT PRIMARY KEY,                 -- uuid
  token_hash   TEXT NOT NULL UNIQUE,             -- sha256(token) — kurrë token-i i papërpunuar
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id   TEXT REFERENCES companies(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  user_agent   TEXT NOT NULL DEFAULT '',
  ip           TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx    ON refresh_tokens (user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS refresh_tokens_expiry_idx  ON refresh_tokens (expires_at);
CREATE INDEX IF NOT EXISTS refresh_tokens_company_idx ON refresh_tokens (company_id);

-- Kjo tabelë NUK ka company_id si kolonë detyruese (është e lidhur me përdoruesin),
-- prandaj politika e saj është vetëm për veten/superadmin: asnjë përdorues nuk mund
-- të lexojë ose revokojë refresh token-in e një përdoruesi tjetër.
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refresh_tokens_owner ON refresh_tokens;
CREATE POLICY refresh_tokens_owner ON refresh_tokens
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (public.app_is_superadmin() OR user_id = public.app_user_id())
  WITH CHECK (public.app_is_superadmin() OR user_id = public.app_user_id());

-- Pastrim i skaduarve (thirret nga një job ose nga POST /api/auth/refresh herë pas here).
CREATE OR REPLACE FUNCTION public.prune_refresh_tokens() RETURNS integer
LANGUAGE sql AS $$
  WITH del AS (
    DELETE FROM public.refresh_tokens
     WHERE expires_at < NOW() - INTERVAL '3 days' OR revoked_at < NOW() - INTERVAL '30 days'
    RETURNING 1
  ) SELECT count(*)::int FROM del;
$$;
