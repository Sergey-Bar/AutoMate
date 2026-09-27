-- Q0.15 item 7 -- `runner_identities` and `runner_enrollment_tokens` were a second,
-- parallel answer to "what is a runner".
--
-- `runners` is the table the product uses. It is what `execution_jobs.lease_owner`
-- references (with `onDelete: restrict`, so a job cannot be leased to a runner that
-- does not exist), it carries the workspace scope, and its `health` column is
-- constrained by `runners_health_check`. `runner_identities` overlapped it by name
-- and intent and disagreed about the rest:
--
--   - **A third status vocabulary.** `runners` has `health`; `runner_identities`
--     had `status` constrained to `pending | active | revoked`; and
--     `RunnerControlService` in `apps/api/src/services/runner-control.ts` has an
--     in-process `status` of `active | draining | revoked`. Three answers to
--     "is this runner usable", none of them the others'.
--   - **A different notion of identity.** `runners` identifies by a workspace and
--     a name; `runner_identities` identified by a free-text name with no workspace
--     column at all, so it could not be scoped.
--   - **No writer and no reader.** `runnerIdentities` and `runnerEnrollmentTokens`
--     are declared in the Drizzle schema and created here, and that is the whole
--     of their existence: no application code reads or writes either. The enrollment
--     route (`/api/v1/runner/v1/enroll`) keeps its identities in process memory,
--     which is what `docs/migration/capability-register.md` already records for
--     `auth.service-credentials`.
--
-- So the FK mismatch this item was written about cannot bite today -- there is no
-- row to mismatch. What it *can* do is be read as an answer, which is worse: a
-- future writer reaching for the obviously-intended table would populate a schema
-- the scheduler never consults, and nothing would say so. The honest correction for
-- an unused second answer is to remove it.
--
-- `runner_enrollment_tokens` goes with it: its only relationship is its
-- `runner_id` foreign key to `runner_identities`, and it has the same absent
-- writer.
--
-- **The emptiness check is not ceremony.** A self-hosted install could hold rows
-- written by a version not in this repository, or by hand. Failing loudly with the
-- row count is the difference between "there was nothing there" and "something was
-- there and was deleted", and only the second one needs a decision from a person.
-- A migration that cannot tell the operator which of the two happened is not
-- finishing the job it started.

DO $$
DECLARE
  identities BIGINT;
  tokens BIGINT;
BEGIN
  IF to_regclass('public.runner_identities') IS NOT NULL THEN
    SELECT count(*) INTO identities FROM public.runner_identities;
    IF identities > 0 THEN
      RAISE EXCEPTION
        'runner_identities holds % row(s); it has no writer in this codebase, so these rows came from somewhere else. Inspect and migrate them to `runners` before re-running.', identities;
    END IF;
  END IF;
  IF to_regclass('public.runner_enrollment_tokens') IS NOT NULL THEN
    SELECT count(*) INTO tokens FROM public.runner_enrollment_tokens;
    IF tokens > 0 THEN
      RAISE EXCEPTION
        'runner_enrollment_tokens holds % row(s); it has no writer in this codebase. Inspect and migrate them before re-running.', tokens;
    END IF;
  END IF;
END
$$;
--> statement-breakpoint
-- Tokens first: the foreign key points at identities.
DROP TABLE IF EXISTS "runner_enrollment_tokens";
--> statement-breakpoint
DROP TABLE IF EXISTS "runner_identities";
