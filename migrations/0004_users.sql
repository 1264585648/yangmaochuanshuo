-- Lightweight user system, layer A: server-issued anonymous identities.
-- A user row is created on the first draw, never on a plain page view.
-- Later layers attach login credentials to the same row ('member').

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL DEFAULT 'guest' CHECK (kind IN ('guest', 'member')),
  created_at   TEXT NOT NULL,
  -- Refreshed at most once per day to keep D1 writes low.
  last_seen_at TEXT NOT NULL
);

-- Cookie sessions. Only a SHA-256 hash of each token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX sessions_user ON sessions (user_id);
