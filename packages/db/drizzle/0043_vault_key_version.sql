-- The vault key generation each envelope was sealed under. Every existing row was sealed under
-- the one secret this installation has had, which is generation 1. A rotation
-- (`rotateVaultSecrets` in `apps/api/src/services/vault-secrets.ts`) re-seals every entry of a
-- workspace under the new secret and raises this by one, in one transaction.

ALTER TABLE "vault_entries" ADD COLUMN IF NOT EXISTS "key_version" integer DEFAULT 1 NOT NULL;
