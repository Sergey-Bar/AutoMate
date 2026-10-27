-- `tests.stable_id` becomes the test's identity across runs, for every row.
--
-- The column existed from 0000 with an index on it, and nothing wrote it. Flakiness and
-- quarantine were keyed on `file › title` computed at read time, which made one test run in
-- two Playwright projects a single test that flipped on every run.
--
-- `automate_test_identity` is `testIdentity` in `@automate/shared-contracts` for a row with no
-- describe path and no project: each segment escapes `\`, `›`, `[` and `{`, and the segments
-- are joined with ` › `. `tests/integration/src/test-identity.test.ts` holds the two to the
-- same output over titles carrying every escaped character.
--
-- Every product writer sends the identity. The insert trigger fills it for one that does not
-- (a hand-written fixture, the legacy SQLite import), so NOT NULL is true of every row rather
-- than of the rows the product happened to write.

CREATE FUNCTION automate_test_identity(file text, title text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws(' › ',
    replace(replace(replace(replace(coalesce(file, ''), '\', '\\'), '›', '\›'), '[', '\['), '{', '\{'),
    replace(replace(replace(replace(title, '\', '\\'), '›', '\›'), '[', '\['), '{', '\{'))
$$;
--> statement-breakpoint
CREATE FUNCTION automate_tests_fill_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stable_id IS NULL OR NEW.stable_id = '' THEN
    NEW.stable_id := automate_test_identity(NEW.file, NEW.title);
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
UPDATE tests SET stable_id = automate_test_identity(file, title)
WHERE stable_id IS NULL OR stable_id = '';
--> statement-breakpoint
CREATE TRIGGER tests_fill_identity BEFORE INSERT ON tests
FOR EACH ROW EXECUTE FUNCTION automate_tests_fill_identity();
--> statement-breakpoint
ALTER TABLE tests ALTER COLUMN stable_id SET NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS tests_stable_id_idx;
--> statement-breakpoint
CREATE INDEX tests_workspace_stable_id_idx ON tests (workspace_id, stable_id);
