-- Q0.15 item 3 — one spelling per state.
--
-- `tests.status` accepted both `timedOut` and `timed_out`. Nothing writes or
-- reads the camelCase spelling: `testStatus()` in the execution store maps
-- anything it does not recognise to `unknown` on the way back out. So a row
-- written as `timedOut` was a timed-out test that read back as *unobserved*,
-- and a `GROUP BY status` split one logical state into two rows — a failure the
-- column's consumer cannot distinguish.
--
-- The snake_case spelling is the live one: it is what `ExecutionTestStatus`
-- declares, what `testStatus()` maps, and what the reporter adapters emit. The
-- camelCase value is normalised away and a CHECK keeps it out.

UPDATE "tests" SET "status" = 'timed_out' WHERE "status" = 'timedOut';

ALTER TABLE "tests" DROP CONSTRAINT IF EXISTS "tests_status_check";
ALTER TABLE "tests"
  ADD CONSTRAINT "tests_status_check"
  CHECK (
    "status" in (
      'passed',
      'failed',
      'flaky',
      'skipped',
      'timed_out',
      'running',
      'queued',
      'blocked',
      'cancelled',
      'unknown'
    )
  );
