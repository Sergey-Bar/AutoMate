-- Q0.16 — fail closed on the controls that decide what counts as a pass.
--
-- Four changes, each closing a place where the database itself was more
-- permissive than the product's "evidence before claims" promise:
--
--  1. `quarantine.status` defaulted to `approved`. A test entered the
--     quarantine — the single control that removes a flaky test from the pass
--     rate — and was immediately hidden, with nobody deciding that. It now
--     defaults to `pending`, so a quarantined test still counts until a human
--     resolves it.
--
--  2. `quarantine.ttf_ms` (time to fix) could be recorded with no
--     `resolved_at`, so a row claimed a fix duration for a resolution that
--     never happened. The two are now tied.
--
--  3. `api_keys.role` defaulted to `admin`. A key created without a role
--     silently received full administrative access. It now defaults to
--     `viewer`, and an admin key must declare its scopes.
--
--  4. `artifacts_evidence_check` exempted every row carrying a
--     `legacy_attachment_id` from having a checksum and a size. That exemption
--     applied to a mutable column, not to a historical snapshot, so any artifact
--     could opt out of carrying evidence just by setting that column. It is
--     removed and the legacy rows are backfilled, so no row has to be exempt.

-- 1. Quarantine fails closed.
ALTER TABLE "quarantine" ALTER COLUMN "status" SET DEFAULT 'pending';
UPDATE "quarantine" SET "status" = 'pending' WHERE "status" = 'approved' AND "resolved_at" IS NULL;

-- 2. A fix duration requires a resolution.
ALTER TABLE "quarantine" DROP CONSTRAINT IF EXISTS "quarantine_ttf_resolution_check";
ALTER TABLE "quarantine"
  ADD CONSTRAINT "quarantine_ttf_resolution_check"
  CHECK ("ttf_ms" IS NULL OR "resolved_at" IS NOT NULL);

-- 3. A new API key is a viewer, not an administrator.
ALTER TABLE "api_keys" ALTER COLUMN "role" SET DEFAULT 'viewer';
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_admin_role_explicit_check";
ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_admin_role_explicit_check"
  CHECK (role <> 'admin' OR scopes IS NOT NULL);

-- 4. Every artifact carries a checksum and a size, legacy rows included.
--
-- The backfill cannot re-derive a digest from bytes it no longer has. Rather
-- than exempt the row, it records the all-zero digest and a size of 0, which
-- is detectable: no real sha256 of any content is all zeros, and a size of 0
-- is falsy. Consumers must treat a zero digest as "legacy, size unknown"
-- rather than as a verified zero-byte artifact. Rows that already carry a real
-- digest are untouched.
UPDATE "artifacts"
  SET "checksum" = '0000000000000000000000000000000000000000000000000000000000000000'
  WHERE "legacy_attachment_id" IS NOT NULL AND "checksum" IS NULL;
UPDATE "artifacts"
  SET "size_bytes" = 0
  WHERE "legacy_attachment_id" IS NOT NULL AND "size_bytes" IS NULL;

ALTER TABLE "artifacts" DROP CONSTRAINT IF EXISTS "artifacts_evidence_check";
ALTER TABLE "artifacts"
  ADD CONSTRAINT "artifacts_evidence_check"
  CHECK (
    "checksum_algorithm" = 'sha256'
    AND "checksum" IS NOT NULL
    AND "checksum" ~ '^[0-9a-f]{64}$'
    AND "size_bytes" IS NOT NULL
  );

-- 5. `generated_test_suggestions.updated_at` defaulted to the Unix epoch through
--    a cast, so a freshly inserted row looked 56 years stale — indistinguishable
--    from a suggestion nobody had ever touched.
UPDATE "generated_test_suggestions"
  SET "updated_at" = "created_at"
  WHERE "updated_at" < '2000-01-01T00:00:00Z';
ALTER TABLE "generated_test_suggestions" ALTER COLUMN "updated_at" SET DEFAULT now();
