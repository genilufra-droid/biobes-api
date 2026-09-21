-- Backup-et me datë në server: kopje e app_state për çdo ditë/veprim, me rikthim.
CREATE TABLE IF NOT EXISTS backups(
  id BIGSERIAL PRIMARY KEY,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  label TEXT NOT NULL DEFAULT '',
  taken_by TEXT NOT NULL DEFAULT '',
  state_version INT NOT NULL DEFAULT 0,
  size_bytes INT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS backups_taken_at_idx ON backups(taken_at DESC);
