-- C-6. `locator_suggestions.status` moves (pending -> accepted | rejected | expired) and
-- the table had no `updated_at`, so a decision on a suggestion could not be dated. Added
-- with a default so the statement is safe on a populated table: an existing row gets the
-- migration time, which is the earliest moment anything can say about it.
ALTER TABLE "locator_suggestions"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
