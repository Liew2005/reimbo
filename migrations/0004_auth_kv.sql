-- Private key/value store for auth secrets (kept apart from `settings`, which the API returns whole).
CREATE TABLE IF NOT EXISTS auth_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
