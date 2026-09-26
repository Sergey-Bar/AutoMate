-- Q0.13 — bound the queries on the event-append path, and make the bound real.
--
-- `appendEvents` loaded **every** event for the run to build its dedupe map, and
-- read "has this run already completed?" out of that same full scan. Both grew
-- with the length of the run's history, so a long run got slower to append to on
-- every batch: the cost of the operation was a function of how long the run had
-- been going rather than how large the batch was.
--
-- Two indexes, and the second exists for a reason worth stating. Narrowing the
-- predicate to `event_key IN (…)` did **not** bound the read on its own: with
-- `(workspace_id, event_id)` named as well, the planner still preferred
-- `run_events_workspace_received_idx` and applied the key as a filter, which
-- reads every event in the workspace. A `WHERE` clause constrains results, not
-- work done. An index whose *leading* column is the predicate leaves the planner
-- no cheaper alternative, which is the only way to make the bound a property of
-- the statement rather than of the planner's mood on the day.
--
-- `event_key` is `${run_id}:${event_id}`, so the batch's keys are already
-- run-scoped and this index is as selective as the primary key for this query.

CREATE INDEX IF NOT EXISTS "run_events_terminal_idx"
  ON "run_events" ("run_id")
  WHERE "type" = 'run.completed';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_events_event_key_idx" ON "run_events" ("event_key");
