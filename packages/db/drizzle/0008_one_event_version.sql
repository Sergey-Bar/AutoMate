-- Q0.15 item 5 — one event version.
--
-- `outboxEvents.event_version` defaulted to **2** while the contract's
-- `DurableSseRecordSchema`, the SSE frame, and every writer used **1**. A writer
-- that omitted the field — which the type made optional — produced a row a
-- consumer could never match against the frame, because it compared 2 to 1 and
-- found no equality. The mismatch was silent in both directions: no validation
-- rejected either value, and nothing reported the disagreement.

ALTER TABLE "outbox_events" ALTER COLUMN "event_version" SET DEFAULT 1;

-- Rows written under the old default are unreadable to a version-1 consumer, so
-- they are normalised rather than left to fail a comparison that can never pass.
UPDATE "outbox_events" SET "event_version" = 1 WHERE "event_version" = 2;
