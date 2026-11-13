-- Closed-beta support: official-link click stats, user feedback, and the
-- community group settings shown on the site.

-- When an offer first went live. Drives the "新上架" label; set by publish.
ALTER TABLE offers ADD COLUMN published_at TEXT;

-- Backfill from the audit log; offers published before the audit trail fall
-- back to their creation time.
UPDATE offers SET published_at = COALESCE(
  (SELECT MIN(a.created_at) FROM audit_log a
    WHERE a.entity_type = 'offer' AND a.entity_id = offers.id AND a.action = 'offer.publish'),
  created_at
)
WHERE status IN ('published', 'expired');

-- One row per (offer, Beijing day, visitor) at most, so repeat clicks cost no
-- writes and the count reads as people. `visitor` is a keyed hash of the
-- caller's network (see worker/src/users/ip.ts); raw IPs are never stored.
CREATE TABLE offer_clicks (
  offer_id TEXT NOT NULL REFERENCES offers (id),
  day      TEXT NOT NULL,
  visitor  TEXT NOT NULL,
  PRIMARY KEY (offer_id, day, visitor)
);

CREATE INDEX offer_clicks_day ON offer_clicks (day);

-- Feedback from visitors: problems with one offer, or the site in general.
CREATE TABLE feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('offer', 'general')),
  offer_id   TEXT REFERENCES offers (id),
  category   TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  -- Optional, typed by the visitor (e.g. a WeChat id or email) so we can reply.
  contact    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((kind = 'offer') = (offer_id IS NOT NULL))
);

CREATE INDEX feedback_status ON feedback (status, id);

-- Small key/value settings edited from /admin. `value` is JSON.
CREATE TABLE site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Images served same-origin (CSP is img-src 'self'), stored base64-encoded.
CREATE TABLE site_assets (
  key          TEXT PRIMARY KEY,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data         TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
