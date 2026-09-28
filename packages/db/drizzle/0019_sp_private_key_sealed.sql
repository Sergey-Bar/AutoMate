-- W7 — the SAML Service Provider private key stops being plaintext.
--
-- `saml_config.sp_private_key` was a `text` column holding the SP's private key in the
-- clear, while everything else this repository considers a secret goes through the
-- vault. A database dump yielded the key directly, and a SP private key is the thing an
-- attacker needs to *authenticate as this installation* to every relying party that
-- trusts it (ledger P-21).
--
-- The column becomes a sealed envelope: the same `VaultEnvelope` shape the vault uses,
-- authenticated as GCM additional authenticated data and bound to the row, so the key
-- cannot be moved from one SAML configuration to another and opened there.
--
-- **This migration refuses to convert an existing key, and that is the point.** Sealing
-- requires the installation vault secret, which a migration does not have — the
-- alternative is a `USING` expression that cannot encrypt, or a plaintext value quietly
-- copied into a column that now looks protected. Neither is acceptable: the second is
-- the worst, because the schema would assert a protection the data does not have. So an
-- installation with a configured key gets a message telling it what to do, and the
-- re-seal is a deliberate application-level pass with the secret in hand, exactly as the
-- version 1 vault envelopes in P-8 are repaired.
--
-- Null is the empty case and is left alone: an installation that has not configured
-- SAML has no key to seal, and forcing one to be set in order to migrate would be the
-- migration inventing configuration.

DO $$
DECLARE
  plaintext_rows integer;
BEGIN
  SELECT count(*) INTO plaintext_rows
    FROM saml_config
   WHERE sp_private_key IS NOT NULL;

  IF plaintext_rows > 0 THEN
    RAISE EXCEPTION
      '% saml_config row(s) hold a plaintext SP private key in sp_private_key, which this migration '
      'will not convert. Sealing needs the installation vault secret, which a migration does not '
      'have, and a column that says jsonb while holding plaintext would assert a protection the data '
      'does not have. Clear the key (or re-save the SAML configuration through the API, which seals '
      'it) and re-run.',
      plaintext_rows;
  END IF;
END
$$;

--> statement-breakpoint
ALTER TABLE saml_config
  ALTER COLUMN sp_private_key TYPE jsonb USING sp_private_key::jsonb;
