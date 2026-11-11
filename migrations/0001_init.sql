-- DealDex catalog schema. Timestamps are ISO-8601 UTC strings; dates are YYYY-MM-DD.

CREATE TABLE providers (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  -- JSON array of registrable domains; source links must be on one of these.
  official_domains TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE offers (
  id                      TEXT PRIMARY KEY,
  provider_id             TEXT NOT NULL REFERENCES providers (id),
  pool                    TEXT NOT NULL CHECK (pool IN ('ai', 'cloud', 'software', 'education')),
  rarity                  TEXT NOT NULL CHECK (rarity IN ('A', 'S', 'SSR')),
  title                   TEXT NOT NULL,
  summary                 TEXT NOT NULL,
  benefit                 TEXT NOT NULL,
  official_url            TEXT NOT NULL,
  source_url              TEXT NOT NULL,
  new_users_only          INTEGER NOT NULL DEFAULT 0 CHECK (new_users_only IN (0, 1)),
  student_only            INTEGER NOT NULL DEFAULT 0 CHECK (student_only IN (0, 1)),
  requires_payment_method INTEGER NOT NULL DEFAULT 0 CHECK (requires_payment_method IN (0, 1)),
  auto_renews             INTEGER NOT NULL DEFAULT 0 CHECK (auto_renews IN (0, 1)),
  -- JSON array of ISO 3166-1 alpha-2 codes; empty means no regional restriction.
  regions                 TEXT NOT NULL DEFAULT '[]',
  conditions_note         TEXT NOT NULL DEFAULT '',
  status                  TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'pending_review', 'published', 'expired')),
  valid_from              TEXT,
  valid_until             TEXT,
  last_verified_at        TEXT,
  -- Optimistic concurrency: every write bumps it, change requests record the base.
  version                 INTEGER NOT NULL DEFAULT 1,
  created_by              TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE INDEX offers_public ON offers (status, pool, rarity);
CREATE INDEX offers_provider ON offers (provider_id);

-- Proposed content edits from callers that may not edit published offers directly.
CREATE TABLE offer_changes (
  id           TEXT PRIMARY KEY,
  offer_id     TEXT NOT NULL REFERENCES offers (id),
  patch        TEXT NOT NULL,
  source_url   TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  reviewed_by  TEXT,
  reviewed_at  TEXT
);

CREATE INDEX offer_changes_pending ON offer_changes (status, offer_id);

-- Callers of the write API. Only a SHA-256 hash of each token is stored.
CREATE TABLE api_clients (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scope      TEXT NOT NULL CHECK (scope IN ('admin', 'inspector')),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  before      TEXT,
  after       TEXT,
  source_url  TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX audit_log_entity ON audit_log (entity_type, entity_id, id);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TABLE idempotency_keys (
  actor           TEXT NOT NULL,
  key             TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body   TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (actor, key)
);

-- Fixed-window counters for write rate limiting.
CREATE TABLE rate_limits (
  actor        TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (actor, window_start)
);
