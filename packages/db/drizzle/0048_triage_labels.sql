-- `fingerprint_categories` becomes a workspace's triage labels (ledger MKT-5).
--
-- It mapped a failure fingerprint to a `defect_categories` row and nothing in the product
-- wrote it. A label — "this cause is an environment problem", "this one is a known issue,
-- tracked at <url>" — is a team's decision about its own failures, so the table becomes
-- workspace-scoped with the same hard boundary every such table has since 0028: NOT NULL,
-- a `restrict` key onto `workspaces`, and a key leading with it.
--
-- The fingerprint is `failureSignature` from `@automate/reporting`: what the insights page
-- clusters on and the per-test history groups by, so a label applies to every recurrence.
--
-- ## Data
--
-- A row already in the table would need a workspace this migration cannot know. Rather than
-- guess, it raises with the count and applies nothing. Nothing in the product ever wrote one.

DO $$
DECLARE
  held integer;
BEGIN
  SELECT count(*) INTO held FROM fingerprint_categories;
  IF held > 0 THEN
    RAISE EXCEPTION 'fingerprint_categories holds % row(s) with no workspace; scope or remove them before 0048', held;
  END IF;
END
$$;
--> statement-breakpoint
INSERT INTO defect_categories (id, name, color, created_at) VALUES
  ('product', 'Product bug', '#6b7280', now()),
  ('test', 'Test bug', '#6b7280', now()),
  ('environment', 'Environment', '#6b7280', now()),
  ('known-issue', 'Known issue', '#6b7280', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE fingerprint_categories ADD COLUMN workspace_id text NOT NULL
  REFERENCES workspaces(id) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE fingerprint_categories DROP CONSTRAINT fingerprint_categories_pkey;
--> statement-breakpoint
ALTER TABLE fingerprint_categories ADD PRIMARY KEY (workspace_id, fingerprint);
--> statement-breakpoint
ALTER TABLE fingerprint_categories ADD COLUMN issue_url text;
--> statement-breakpoint
ALTER TABLE fingerprint_categories ADD COLUMN labelled_by text NOT NULL DEFAULT 'manual';
