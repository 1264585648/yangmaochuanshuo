-- Collection, favorites and one-time import of legacy browser data (user system U3).

-- Imported legacy cards live in `draws` so the collection has one source, but
-- they never count toward the daily quota or appear in the draw history.
ALTER TABLE draws ADD COLUMN source TEXT NOT NULL DEFAULT 'draw' CHECK (source IN ('draw', 'import'));

-- Set when the user's legacy browser data was imported; at most once.
ALTER TABLE users ADD COLUMN imported_at TEXT;

-- Favorites are limited to cards the user owns (enforced by the API).
CREATE TABLE favorites (
  user_id    TEXT NOT NULL REFERENCES users (id),
  offer_id   TEXT NOT NULL REFERENCES offers (id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, offer_id)
);
