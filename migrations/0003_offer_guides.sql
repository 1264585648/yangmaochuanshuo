-- How-to guide for each offer, stored as JSON validated by the Worker
-- (worker/src/domain/guide.ts). Nullable so drafts and pre-existing rows stay
-- valid; publishing requires a guide matching the rarity.
ALTER TABLE offers ADD COLUMN guide TEXT CHECK (guide IS NULL OR json_valid(guide));
