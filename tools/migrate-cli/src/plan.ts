import { createHash } from 'node:crypto';

export interface SourceTable {
  name: string;
  rowCount: number;
  columns: string[];
}

export interface MigrationPlan {
  planVersion: 1;
  toolVersion: string;
  sourceId: string;
  sourceCommit: string;
  targetCommit: string;
  catalogFingerprint: string;
  tables: Array<
    SourceTable & { disposition: 'migrate' | 'retain-dormant' | 'blocked'; reason?: string }
  >;
  artifacts: { digest: string; count: number };
  vault: { envelopeVersion: number; keyReference: string; count: number };
}

const blockedSourceTables = new Set(['users', 'saml_config', 'saml_configs', 'sp_private_key']);
const dormantSourceTables = new Set([
  'predictions',
  'alerts',
  'alert_rules',
  'generation_endpoints',
  'generation_sessions',
]);

export function buildPlan(input: {
  sourceId: string;
  sourceCommit: string;
  targetCommit: string;
  toolVersion: string;
  tables: SourceTable[];
  artifactDigest?: string;
  artifactCount?: number;
  vaultEnvelopeVersion?: number;
  vaultKeyReference?: string;
  vaultCount?: number;
}): MigrationPlan {
  const catalogFingerprint = createHash('sha256')
    .update(
      JSON.stringify(
        input.tables.map(({ name, columns }) => ({ name, columns: [...columns].sort() })),
      ),
    )
    .digest('hex');
  return {
    planVersion: 1,
    toolVersion: input.toolVersion,
    sourceId: input.sourceId,
    sourceCommit: input.sourceCommit,
    targetCommit: input.targetCommit,
    catalogFingerprint,
    tables: input.tables.map((table) => ({
      ...table,
      disposition: blockedSourceTables.has(table.name)
        ? 'blocked'
        : dormantSourceTables.has(table.name)
          ? 'retain-dormant'
          : 'migrate',
      reason: blockedSourceTables.has(table.name)
        ? 'Requires an approved security/identity transformation'
        : dormantSourceTables.has(table.name)
          ? 'Retained as dormant compatibility data'
          : undefined,
    })),
    artifacts: { digest: input.artifactDigest ?? '0'.repeat(64), count: input.artifactCount ?? 0 },
    vault: {
      envelopeVersion: input.vaultEnvelopeVersion ?? 1,
      keyReference: input.vaultKeyReference ?? 'unconfigured',
      count: input.vaultCount ?? 0,
    },
  };
}
