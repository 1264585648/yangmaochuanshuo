-- Server-side draws (user system U2). This table is the single source of truth:
-- the daily quota is the number of rows for (user_id, day), and the collection
-- is derived from the distinct offer_id values per user.

CREATE TABLE draws (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id),
  -- Offers are never hard-deleted, so drawn cards stay resolvable after expiry.
  offer_id   TEXT NOT NULL REFERENCES offers (id),
  pool       TEXT NOT NULL CHECK (pool IN ('ai', 'cloud', 'software', 'education')),
  rarity     TEXT NOT NULL CHECK (rarity IN ('A', 'S', 'SSR')),
  -- Quota day (Beijing time), YYYY-MM-DD.
  day        TEXT NOT NULL,
  idem_key   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, idem_key)
);

CREATE INDEX draws_user_day ON draws (user_id, day);
CREATE INDEX draws_user_offer ON draws (user_id, offer_id);
