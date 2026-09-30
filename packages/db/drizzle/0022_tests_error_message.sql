-- Record why a test failed.
--
-- A failed run's `tests` rows carried a status and nothing else. The reporter has been
-- sending `error: { code, message }` on every `test:end` for the whole life of the
-- protocol — `TestEndPayloadSchema` is `.passthrough()`, so the field was accepted and
-- then written nowhere, because `upsertTest`/`patchTest` had nowhere to put it.
--
-- So the product knew a test failed and did not know why, and the dashboard — whose
-- entire purpose is showing the evidence — rendered a red row with no reason on it.
--
-- Additive and nullable, with no backfill: a row written before this migration has no
-- message, and that is the honest state for a row that was recorded without one. The UI
-- says "no message reported" rather than showing a blank.
--
-- No length constraint in the database, deliberately. The bound belongs where the
-- untrusted payload is read — `normaliseFailure` in
-- `apps/api/src/services/reporter-persistence.ts` truncates to a stated limit and says so
-- — because a `varchar(n)` here would make the truncation a database error rather than a
-- recorded decision, and would silently reject a producer's legitimate long stack trace
-- instead of storing a bounded prefix of it.

ALTER TABLE "tests" ADD COLUMN IF NOT EXISTS "error_code" text;
ALTER TABLE "tests" ADD COLUMN IF NOT EXISTS "error_message" text;
