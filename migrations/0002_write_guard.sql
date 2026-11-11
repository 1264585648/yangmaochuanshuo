-- Atomic precondition checks inside D1 batches.
--
-- A conditional UPDATE that matches no rows does not fail, so later statements
-- in the same batch (audit, idempotency) would still run. Inserting changes()
-- here right after a guarded statement aborts the whole batch unless exactly
-- one row changed. Successful checks are ignored, so the table stays empty.

CREATE TABLE write_guard (
  expected INTEGER NOT NULL
);

CREATE TRIGGER write_guard_pass BEFORE INSERT ON write_guard
WHEN NEW.expected = 1
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER write_guard_fail BEFORE INSERT ON write_guard
WHEN NEW.expected <> 1
BEGIN
  SELECT RAISE(ABORT, 'write_conflict');
END;
