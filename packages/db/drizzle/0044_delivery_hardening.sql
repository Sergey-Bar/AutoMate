-- Delivery hardening: the sync lease gets an owner, a source gets at most one queued sync, and
-- the GitHub webhook's replay store keys on the signed body as well as the unsigned id.
--
-- `delivery_syncs.lease_id` is set afresh by every claim. A running sync's writes — its row's
-- finish, its lease renewal, its source's cursors — all carry it, so a process whose lease
-- lapsed and was reclaimed by another writes nothing more. A row claimed before this migration
-- has none, and the next claim gives it one.
--
-- Before the partial unique index can exist, any source with two queued syncs keeps its
-- oldest and the rest are closed as `superseded`: they were the same request twice, and the
-- one kept does the same work. No row is deleted.
--
-- `webhook_deliveries.body_sha256`: GitHub's `X-Hub-Signature-256` covers the body only, so a
-- captured body re-sent with a fresh `X-GitHub-Delivery` verified and was accepted. Rows from
-- before this migration have no hash; a unique index admits any number of NULLs.

ALTER TABLE "delivery_syncs" ADD COLUMN IF NOT EXISTS "lease_id" uuid;
--> statement-breakpoint
UPDATE "delivery_syncs" AS d
SET "status" = 'failed', "error_code" = 'superseded', "finished_at" = now()
WHERE d."status" = 'queued'
  AND EXISTS (
    SELECT 1 FROM "delivery_syncs" AS o
    WHERE o."source_id" = d."source_id" AND o."status" = 'queued'
      AND (o."created_at", o."id") < (d."created_at", d."id")
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_syncs_one_queued_idx"
  ON "delivery_syncs" USING btree ("source_id") WHERE status = 'queued';
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "body_sha256" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_deliveries_body_idx"
  ON "webhook_deliveries" USING btree ("workspace_id", "provider", "body_sha256");
