ALTER TABLE "artifacts" ALTER COLUMN "size_bytes" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "completion_hash" text;