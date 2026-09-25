import { readFileSync } from 'node:fs';

import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  artifacts,
  auditEvents,
  environments,
  executionJobs,
  gateEvaluations,
  projects,
  qualityPolicies,
  releases,
  runEvents,
  runners,
  runs,
  ARTIFACT_KINDS,
  EXECUTION_JOB_STATES,
  GATE_STATUSES,
  RELEASE_DECISIONS,
  RUN_OUTCOMES,
  RUN_PHASES,
  RUNNER_HEALTH_VALUES,
} from './index.js';

type ColWithEnum = { enumValues?: string[] };

function columns(table: PgTable): string[] {
  return Object.keys(getTableColumns(table));
}

function enumValues(table: PgTable, column: string): string[] | undefined {
  return (getTableColumns(table)[column] as ColWithEnum | undefined)?.enumValues;
}

const migration = readFileSync(
  new URL('../../drizzle/0003_durable_execution.sql', import.meta.url),
  'utf8',
);

const snapshot = JSON.parse(
  readFileSync(new URL('../../drizzle/meta/0003_snapshot.json', import.meta.url), 'utf8'),
) as {
  tables: Record<
    string,
    {
      columns: Record<string, { type: string; primaryKey: boolean; notNull: boolean }>;
      compositePrimaryKeys: Record<string, { name: string; columns: string[] }>;
    }
  >;
};

describe('durable execution schema', () => {
  it('exports every execution table with canonical names', () => {
    const tables: Array<[PgTable, string]> = [
      [runners, 'runners'],
      [executionJobs, 'execution_jobs'],
      [runEvents, 'run_events'],
      [artifacts, 'artifacts'],
      [projects, 'projects'],
      [environments, 'environments'],
      [releases, 'releases'],
      [qualityPolicies, 'quality_policies'],
      [gateEvaluations, 'gate_evaluations'],
    ];

    for (const [table, name] of tables) {
      expect(getTableName(table)).toBe(name);
    }
  });

  it('keeps the legacy run projection while adding canonical fields', () => {
    const runColumns = columns(runs);

    expect(runColumns).toContain('status');
    expect(runColumns).toEqual(
      expect.arrayContaining([
        'externalId',
        'framework',
        'adapterVersion',
        'testType',
        'projectId',
        'environmentId',
        'releaseId',
        'commit',
        'configuration',
        'phase',
        'outcome',
        'attempt',
        'priority',
        'selection',
        'requiredCapabilities',
        'labels',
        'timeoutMs',
        'policyId',
        'idempotencyKey',
        'retryOfRunId',
        'runnerId',
        'currentJobId',
        'eventSequence',
        'completedAt',
        'errorCode',
        'errorMessage',
        'rawEvidenceRefs',
      ]),
    );
    expect(enumValues(runs, 'status')).toEqual(['running', 'passed', 'failed', 'interrupted']);
    expect(enumValues(runs, 'phase')).toEqual([...RUN_PHASES]);
    expect(enumValues(runs, 'outcome')).toEqual([...RUN_OUTCOMES]);
  });

  it('persists runner identity, health, token, capacity, and lease metadata', () => {
    expect(columns(runners)).toEqual(
      expect.arrayContaining([
        'workspaceId',
        'name',
        'version',
        'protocolVersion',
        'os',
        'arch',
        'capabilities',
        'labels',
        'slots',
        'health',
        'tokenHash',
        'tokenExpiresAt',
        'tokenRevokedAt',
        'lastHeartbeatAt',
        'metrics',
      ]),
    );
    expect(enumValues(runners, 'health')).toEqual([...RUNNER_HEALTH_VALUES]);
  });

  it('persists durable queue idempotency and fencing fields', () => {
    expect(columns(executionJobs)).toEqual(
      expect.arrayContaining([
        'workspaceId',
        'runId',
        'attempt',
        'priority',
        'state',
        'availableAt',
        'timeoutMs',
        'spec',
        'input',
        'leaseId',
        'leaseOwner',
        'leaseExpiresAt',
        'heartbeatAt',
        'fencingToken',
        'idempotencyKey',
        'errorCode',
        'errorMessage',
      ]),
    );
    expect(enumValues(executionJobs, 'state')).toEqual([...EXECUTION_JOB_STATES]);
  });

  it('persists idempotent ordered events and complete artifact metadata', () => {
    expect(columns(runEvents)).toEqual(
      expect.arrayContaining([
        'eventId',
        'version',
        'runId',
        'workspaceId',
        'jobId',
        'sequence',
        'source',
        'eventKey',
        'hash',
        'type',
        'payload',
        'leaseId',
        'fencingToken',
        'occurredAt',
        'receivedAt',
      ]),
    );
    expect(columns(artifacts)).toEqual(
      expect.arrayContaining([
        'runId',
        'jobId',
        'testId',
        'resultId',
        'attempt',
        'kind',
        'contentType',
        'storageKey',
        'checksumAlgorithm',
        'checksum',
        'sizeBytes',
        'expiresAt',
        'legalHold',
        'metadata',
        'legacyAttachmentId',
      ]),
    );
    expect(enumValues(artifacts, 'kind')).toEqual([...ARTIFACT_KINDS]);
  });

  it('scopes release quality data and persists deterministic gate decisions', () => {
    for (const table of [projects, environments, releases, qualityPolicies, gateEvaluations]) {
      expect(columns(table)).toContain('workspaceId');
    }
    expect(enumValues(gateEvaluations, 'status')).toEqual([...GATE_STATUSES]);
    expect(enumValues(gateEvaluations, 'decision')).toEqual([...RELEASE_DECISIONS]);
    expect(columns(qualityPolicies)).toEqual(
      expect.arrayContaining(['version', 'hash', 'requiredDomains', 'rules', 'isDefault']),
    );
  });

  it('adds workspace scope to execution audit events', () => {
    expect(columns(auditEvents)).toContain('workspaceId');
  });

  it('keeps snapshot metadata aligned with contract-safe identifiers', () => {
    expect(snapshot.tables['public.runners']?.columns['protocol_version']?.notNull).toBe(true);
    expect(snapshot.tables['public.execution_jobs']?.columns['input']?.notNull).toBe(true);
    expect(snapshot.tables['public.execution_jobs']?.columns['lease_id']?.type).toBe('text');
    expect(snapshot.tables['public.run_events']?.columns['event_id']?.type).toBe('text');
    expect(snapshot.tables['public.run_events']?.columns['lease_id']?.type).toBe('text');
    expect(snapshot.tables['public.run_events']?.compositePrimaryKeys).toEqual({
      run_events_workspace_id_event_id_pk: {
        name: 'run_events_workspace_id_event_id_pk',
        columns: ['workspace_id', 'event_id'],
      },
    });
    expect(snapshot.tables['public.artifacts']?.columns['attempt']).toBeDefined();
  });

  it('keeps migration 0003 additive and includes compatibility backfills', () => {
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
    expect(migration).toContain('ALTER TABLE "runs" ADD COLUMN "phase"');
    expect(migration).toContain("WHEN 'interrupted' THEN 'runner_lost'");
    expect(migration).toContain('"commit" = "commit_sha"');
    expect(migration).toContain('"configuration" = COALESCE("config"');
    expect(migration).toContain('INSERT INTO "artifacts"');
    expect(migration).toContain('jsonb_agg("artifacts"."id"::text');
    expect(migration).toContain("'legacyAttachmentId'");
    expect(migration).toContain('CREATE UNIQUE INDEX "runs_workspace_idempotency_unique"');
    expect(migration).toContain('CREATE UNIQUE INDEX "run_events_run_sequence_unique"');
    expect(migration).toContain('CREATE UNIQUE INDEX "run_events_run_hash_unique"');
    expect(migration).toContain('"event_id" text NOT NULL');
    expect(migration).toContain('PRIMARY KEY("workspace_id","event_id")');
    expect(migration).toContain('FOREIGN KEY ("current_job_id")');
  });
});
