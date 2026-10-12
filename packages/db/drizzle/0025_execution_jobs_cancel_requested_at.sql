-- W3 — the cancel handshake, as a column on `execution_jobs`.
--
-- **P5: the cancel path was one-sided, and the reason was a write that destroyed
-- its own evidence.** `cancelRun` cleared the job's `leaseId`, `leaseOwner` and
-- `leaseExpiresAt`, so by the time the runner's next heartbeat asked "anything
-- for me?" there was no owner left to ask. The request was recorded on the run
-- (`runs.cancel_requested_at`, migration 0003) and nothing on the job, so a
-- cancelled run kept executing to completion and then failed to complete —
-- its lease was gone.
--
-- The column is nullable and defaults to NULL, because "no cancel was asked
-- for" is the state of every row that has ever existed, and a NOT NULL with a
-- default of `now()` would backdate every historical job to the moment the
-- migration ran.
--
-- Indexed on `(lease_owner, cancel_requested_at)` rather than alone: the
-- heartbeat's query is "the jobs *this runner holds* that were asked to stop",
-- which leads with the owner and uses the timestamp only to identify them. An
-- index on the timestamp alone would scan every cancelled job in the install
-- for every heartbeat.

ALTER TABLE "execution_jobs"
  ADD COLUMN IF NOT EXISTS "cancel_requested_at" timestamp with time zone;

-- The read path, in the shape the heartbeat filters in. Partial, because a
-- completed job's request is historical fact and never part of the answer —
-- keeping it in the index would grow it for rows that stop being read.
CREATE INDEX IF NOT EXISTS "execution_jobs_cancel_requested_idx"
    ON "execution_jobs" ("lease_owner", "cancel_requested_at")
 WHERE "cancel_requested_at" IS NOT NULL;
