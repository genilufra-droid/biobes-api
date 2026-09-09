-- Epoka e fshirjes totale: shenja që detyron çdo pajisje të pastrohet
-- (Reset me 0 gjurmë kudo). Pastrohet nga PUT-i i parë i miratuar pas wipe-it.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
