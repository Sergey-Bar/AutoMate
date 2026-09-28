-- W7 — connector credentials and settings become per workspace.
--
-- `vault_entries.connector_name` and `connector_configs.connector_name` were each
-- `UNIQUE` on their own, and neither table had a workspace column. One row per
-- connector name, installation-wide, is one credential for the whole installation
-- (ledger P-7) — so two tenants configuring GitHub shared a single row, and the second
-- write silently updated the first tenant's credential. Whether it overwrote or
-- collided, the result is a tenant reading or losing another tenant's secret.
--
-- The unique constraint becomes `(workspace_id, connector_name)`, the only scope in which
-- "one credential for this connector" means anything. This is the same treatment
-- `schedules` got in 0015, `outbox_events` in 0017 and the chat tables in 0018, and for
-- the same reason: a tenancy boundary applied to some tables and not others is not a
-- boundary.
--
-- **The backfill cannot be invented.** A credential with no workspace cannot be
-- attributed to one, and attributing it to a default would place one tenant's secret
-- under another tenant's name — the defect being fixed, performed by the fix. The
-- pre-audit raises and counts so an operator decides per row: re-scope it to the
-- workspace that actually configured the connector, or delete it. In a single-tenant
-- installation — which is what D10 commits to — the operator scopes every row to the one
-- workspace that exists, and the migration is otherwise a no-op.
--
-- The column is added *nullable* first and tightened only after the audit. An audit
-- that runs after `NOT NULL` fails with a constraint error instead of the count an
-- operator needs to make a decision.
--
-- **`iterations` is deliberately left in place and is not fixed here.** It is currently
-- unread: the KDF derives at a hardcoded 100 000 iterations rather than at whatever the
-- row records, so a row carrying a different value states a cost it does not pay. That is
-- a real inconsistency, and it belongs with the envelope work in the vault hardening,
-- where the derivation and the stored parameters are made to agree — changing the KDF in
-- the same migration that adds tenancy would mean a rollback undoes both. Recorded as an
-- open item rather than quietly resolved.

ALTER TABLE vault_entries ADD COLUMN workspace_id text;
--> statement-breakpoint
ALTER TABLE connector_configs ADD COLUMN workspace_id text;

DO $BODY$
DECLARE
  unattributed_entries integer;
  unattributed_configs integer;
BEGIN
  SELECT count(*) INTO unattributed_entries FROM vault_entries WHERE workspace_id IS NULL;
  SELECT count(*) INTO unattributed_configs FROM connector_configs WHERE workspace_id IS NULL;

  IF unattributed_entries > 0 OR unattributed_configs > 0 THEN
    RAISE EXCEPTION
      '% vault_entries row(s) and % connector_configs row(s) carry no workspace_id, and both '
      'connector_name columns are currently unique installation-wide. Until every row is re-scoped, a '
      'credential written by one tenant can be read or overwritten by another — which is the defect '
      'this migration fixes — and guessing an attribution would place one tenant''s secret under '
      'another''s name. Re-scope each row to the workspace that configured the connector, or delete it.',
      unattributed_entries, unattributed_configs;
  END IF;
END
$BODY$;

ALTER TABLE vault_entries ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE connector_configs ALTER COLUMN workspace_id SET NOT NULL;

-- The global uniqueness is what let one row serve every tenant. Replaced rather than
-- supplemented: keeping the single-column constraint as well would stop two tenants
-- configuring the same connector at all, which is the opposite of the fix.
-- Named as the earlier migrations spelled it, because a `UNIQUE` constraint and the
-- index behind it are one object in Postgres: the `DROP CONSTRAINT` removes both, and a
-- separate `DROP INDEX` on the same name fails with "constraint requires it".
--
-- The first version guessed the `_key` spelling that `IF EXISTS` then silently swallowed,
-- so the global uniqueness survived a migration that appeared to replace it — a central
-- statement that can no-op and still succeed. The test that now covers this inserts the
-- same connector for two workspaces, which is the only way to notice.
ALTER TABLE vault_entries DROP CONSTRAINT IF EXISTS vault_entries_connector_name_unique;
--> statement-breakpoint
ALTER TABLE connector_configs DROP CONSTRAINT IF EXISTS connector_configs_connector_name_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX vault_entries_workspace_connector_idx
    ON vault_entries (workspace_id, connector_name);
--> statement-breakpoint
CREATE UNIQUE INDEX connector_configs_workspace_connector_idx
    ON connector_configs (workspace_id, connector_name);
