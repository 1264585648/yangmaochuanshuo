-- Limited prizes: real benefits the site owner holds (redemption codes, invite
-- links) with a fixed stock. Every real draw carries one extra roll; a win
-- assigns one unclaimed code to that draw. The prize odds and stock are public,
-- the codes are only ever returned to the winning session.

CREATE TABLE prizes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  -- How to redeem, shown to the winner and on the public rules.
  description TEXT NOT NULL DEFAULT '',
  -- Stated value for the public rules, e.g. "价值约 20 元".
  value_note  TEXT NOT NULL DEFAULT '',
  -- Optional https page where the code is redeemed.
  redeem_url  TEXT,
  -- Chance per draw, while stock lasts. The sum over live prizes is capped by the API.
  chance      REAL NOT NULL CHECK (chance > 0 AND chance <= 0.2),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  starts_at   TEXT,
  ends_at     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- One row per unit of stock. `draw_id` is null while the unit is unclaimed.
CREATE TABLE prize_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  prize_id   TEXT NOT NULL REFERENCES prizes (id),
  code       TEXT NOT NULL,
  draw_id    TEXT UNIQUE REFERENCES draws (id),
  user_id    TEXT REFERENCES users (id),
  -- Keyed hash of the winner's network (see worker/src/users/ip.ts) and the
  -- Beijing quota day of the win, for the per-network daily cap.
  visitor    TEXT,
  day        TEXT,
  claimed_at TEXT,
  UNIQUE (prize_id, code),
  CHECK ((draw_id IS NULL) = (user_id IS NULL))
);

CREATE INDEX prize_codes_stock ON prize_codes (prize_id, draw_id);
-- For the cap on total wins per day.
CREATE INDEX prize_codes_day ON prize_codes (day);

-- Win caps, also checked by the claim statement: one prize per user, ever,
-- and one per network per day (IPv6 networks are bucketed by /48 here).
CREATE UNIQUE INDEX prize_codes_one_per_user ON prize_codes (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX prize_codes_one_per_network_day ON prize_codes (visitor, day)
  WHERE visitor IS NOT NULL;
