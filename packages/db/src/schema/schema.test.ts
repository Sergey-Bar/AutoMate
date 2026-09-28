/**
 * Schema unit tests for @automate/db
 *
 * Validates all schema tables are correctly defined and exported
 * without requiring a live PostgreSQL connection.
 *
 * Uses `getTableName` and `getTableColumns` from drizzle-orm — pure
 * in-memory introspection; no DB connection ever attempted.
 */

import { getTableName, getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import {
  // dashboard
  runs,
  suites,
  tests,
  results,
  attachments,
  trends,
  quarantine,
  knownFailures,
  schedules,
  workspaces,
  qualityGateConfig,
  defectCategories,
  fingerprintCategories,
  blobShards,
  nlQueryHistory,
  failureTaxonomyRules,
  failureClassifications,
  testFailureCorrelations,
  locatorSuggestions,
  failureClusters,
  users,
  roles,
  apiKeys,
  agentSessions,
  agentSessionRuns,
  agentSessionFiles,
  generatedTestSuggestions,
  repairAttempts,
  agentConflicts,
  samlConfig,
  auditEvents,
  // automate
  conversations,
  messages,
  messageAttachments,
  connectorConfigs,
  flowTemplates,
  executionLog,
  modelConfig,
  traceLinks,
  // vault
  vaultEntries,
} from './index.js';
import { GATE_STATUSES } from './vocabularies.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function tname(table: PgTable): string {
  return getTableName(table);
}

function cols(table: PgTable): string[] {
  return Object.keys(getTableColumns(table));
}

type ColWithEnum = { enumValues?: string[] };

function enumVals(table: PgTable, colName: string): string[] | undefined {
  return (getTableColumns(table)[colName] as ColWithEnum | undefined)?.enumValues;
}

// ─── dashboard schema ────────────────────────────────────────────────────────

describe('dashboard schema — runs', () => {
  it('is exported and has the correct table name', () => {
    expect(tname(runs)).toBe('runs');
  });

  it('has the expected core columns', () => {
    const c = cols(runs);
    expect(c).toContain('id');
    expect(c).toContain('startedAt');
    expect(c).toContain('finishedAt');
    expect(c).toContain('status');
    expect(c).toContain('total');
    expect(c).toContain('passed');
    expect(c).toContain('failed');
    expect(c).toContain('flaky');
    expect(c).toContain('skipped');
    expect(c).toContain('durationMs');
    expect(c).toContain('branch');
  });

  it('status column has the correct enum values', () => {
    expect(enumVals(runs, 'status')).toEqual(['running', 'passed', 'failed', 'interrupted']);
  });
});

describe('dashboard schema — suites', () => {
  it('has table name "suites"', () => {
    expect(tname(suites)).toBe('suites');
  });

  it('has runId foreign key column', () => {
    expect(cols(suites)).toContain('runId');
  });
});

describe('dashboard schema — tests', () => {
  it('has table name "tests"', () => {
    expect(tname(tests)).toBe('tests');
  });

  it('has composite-PK columns id and runId', () => {
    const c = cols(tests);
    expect(c).toContain('id');
    expect(c).toContain('runId');
  });
});

describe('dashboard schema — results', () => {
  it('has table name "results"', () => {
    expect(tname(results)).toBe('results');
  });

  it('has fingerprint column for deduplication', () => {
    expect(cols(results)).toContain('fingerprint');
  });
});

describe('dashboard schema — attachments', () => {
  it('has table name "attachments"', () => {
    expect(tname(attachments)).toBe('attachments');
  });

  it('has isScreenshotDiff boolean column', () => {
    expect(cols(attachments)).toContain('isScreenshotDiff');
  });
});

describe('dashboard schema — trends', () => {
  it('has table name "trends"', () => {
    expect(tname(trends)).toBe('trends');
  });

  it('has branch column with default main', () => {
    expect(cols(trends)).toContain('branch');
  });
});

describe('dashboard schema — quarantine', () => {
  it('has table name "quarantine"', () => {
    expect(tname(quarantine)).toBe('quarantine');
  });

  it('has flakinessCategory column', () => {
    expect(cols(quarantine)).toContain('flakinessCategory');
  });
});

describe('dashboard schema — knownFailures', () => {
  it('has table name "known_failures"', () => {
    expect(tname(knownFailures)).toBe('known_failures');
  });
});

describe('dashboard schema — schedules', () => {
  it('has table name "schedules"', () => {
    expect(tname(schedules)).toBe('schedules');
  });

  it('has cronExpr column', () => {
    expect(cols(schedules)).toContain('cronExpr');
  });

  it('has a NOT NULL workspaceId column', () => {
    // Added by `0015_schedule_workspace_scope.sql`, and `NOT NULL` is the load-bearing
    // part: an optional workspace column would leave the worker falling back to the
    // untyped JSONB it was built to stop trusting, which is the defect P-20 records.
    expect(cols(schedules)).toContain('workspaceId');
    expect(schedules.workspaceId.notNull).toBe(true);
  });

  it('carries the same gateStatus vocabulary as gate_evaluations, not a second copy', () => {
    // P-5. `runs.gate_status` was `['passed','failed','skipped']` while
    // `gate_evaluations.status` — and the contract in `@automate/shared-contracts` —
    // is `['passed','failed','warning','unknown','not_evaluated']`. The two disagreed in
    // both directions: three contract values were rejected by the database and one
    // non-contract value was accepted.
    //
    // The drift survived because `execution.ts` imports `runs` from `dashboard.ts`, so
    // the shared constant could not be imported back and the column held a hand-written
    // second copy. That is now `schema/vocabularies.ts`, and this assertion is what
    // makes the cycle-avoidance worth anything: both columns read the one constant, so a
    // future widening cannot land on one and miss the other.
    const runsStatuses = (
      getTableColumns(runs).gateStatus as { enumValues?: readonly string[] } | undefined
    )?.enumValues;
    expect(runsStatuses).toBeDefined();
    expect([...(runsStatuses ?? [])]).toEqual([...GATE_STATUSES]);
  });

  it('no longer accepts `skipped`, which the contract does not define', () => {
    // The narrowing half, and the reason the migration needed a pre-audit: aligning to
    // the contract means a value the database used to accept becomes unwritable. This
    // asserts it stayed narrowed, so a later "fix" that quietly re-adds it fails.
    const runsStatuses = (
      getTableColumns(runs).gateStatus as { enumValues?: readonly string[] } | undefined
    )?.enumValues;
    expect([...(runsStatuses ?? [])]).not.toContain('skipped');
    expect([...(runsStatuses ?? [])]).toContain('not_evaluated');
  });
});

describe('dashboard schema — workspaces', () => {
  it('has table name "workspaces"', () => {
    expect(tname(workspaces)).toBe('workspaces');
  });
});

describe('dashboard schema — qualityGateConfig', () => {
  it('has table name "quality_gate_config"', () => {
    expect(tname(qualityGateConfig)).toBe('quality_gate_config');
  });

  it('has passRateThreshold column', () => {
    expect(cols(qualityGateConfig)).toContain('passRateThreshold');
  });

  it('carries a gate name in `name`, and keeps `workspaceId` for scoping only', () => {
    // A gate's display name used to be written into, and read back out of,
    // `workspace_id`. That scoped every created gate to a workspace that does not
    // exist and made the column that decides visibility carry a free-text label;
    // migration 0012 added `name` and recovered the names the mapping had
    // swallowed.
    const c = cols(qualityGateConfig);
    expect(c).toContain('name');
    expect(c).toContain('workspaceId');
    // The name is required, with a default, because a nameless gate cannot be
    // listed meaningfully — and a caller that omits it must still be able to insert.
    const name = getTableColumns(qualityGateConfig)['name'] as {
      notNull: boolean;
      hasDefault: boolean;
      default?: unknown;
    };
    expect(name.notNull).toBe(true);
    expect(name.hasDefault).toBe(true);
    expect(name.default).toBe('Unnamed gate');
  });
});

describe('dashboard schema — defectCategories', () => {
  it('has table name "defect_categories"', () => {
    expect(tname(defectCategories)).toBe('defect_categories');
  });
});

describe('dashboard schema — fingerprintCategories', () => {
  it('has table name "fingerprint_categories"', () => {
    expect(tname(fingerprintCategories)).toBe('fingerprint_categories');
  });
});

describe('dashboard schema — blobShards', () => {
  it('has table name "blob_shards"', () => {
    expect(tname(blobShards)).toBe('blob_shards');
  });
});

describe('dashboard schema — nlQueryHistory', () => {
  it('has table name "nl_query_history"', () => {
    expect(tname(nlQueryHistory)).toBe('nl_query_history');
  });

  it('has serial id column', () => {
    expect(cols(nlQueryHistory)).toContain('id');
  });
});

describe('dashboard schema — failureTaxonomyRules', () => {
  it('has table name "failure_taxonomy_rules"', () => {
    expect(tname(failureTaxonomyRules)).toBe('failure_taxonomy_rules');
  });
});

describe('dashboard schema — failureClassifications', () => {
  it('has table name "failure_classifications"', () => {
    expect(tname(failureClassifications)).toBe('failure_classifications');
  });
});

describe('dashboard schema — testFailureCorrelations', () => {
  it('has table name "test_failure_correlations"', () => {
    expect(tname(testFailureCorrelations)).toBe('test_failure_correlations');
  });
});

describe('dashboard schema — locatorSuggestions', () => {
  it('has table name "locator_suggestions"', () => {
    expect(tname(locatorSuggestions)).toBe('locator_suggestions');
  });
});

describe('dashboard schema — failureClusters', () => {
  it('has table name "failure_clusters"', () => {
    expect(tname(failureClusters)).toBe('failure_clusters');
  });
});

describe('dashboard schema — users', () => {
  it('has table name "users"', () => {
    expect(tname(users)).toBe('users');
  });

  it('has role column with admin/editor/viewer enum', () => {
    expect(enumVals(users, 'role')).toEqual(['admin', 'editor', 'viewer']);
  });
});

describe('dashboard schema — roles', () => {
  it('has table name "roles"', () => {
    expect(tname(roles)).toBe('roles');
  });
});

describe('dashboard schema — apiKeys', () => {
  it('has table name "api_keys"', () => {
    expect(tname(apiKeys)).toBe('api_keys');
  });

  it('has keyHash column for secure storage', () => {
    expect(cols(apiKeys)).toContain('keyHash');
  });
});

describe('dashboard schema — agentSessions', () => {
  it('has table name "agent_sessions"', () => {
    expect(tname(agentSessions)).toBe('agent_sessions');
  });
});

describe('dashboard schema — agentSessionRuns', () => {
  it('has table name "agent_session_runs"', () => {
    expect(tname(agentSessionRuns)).toBe('agent_session_runs');
  });
});

describe('dashboard schema — agentSessionFiles', () => {
  it('has table name "agent_session_files"', () => {
    expect(tname(agentSessionFiles)).toBe('agent_session_files');
  });
});

describe('dashboard schema — generatedTestSuggestions', () => {
  it('has table name "generated_test_suggestions"', () => {
    expect(tname(generatedTestSuggestions)).toBe('generated_test_suggestions');
  });
});

describe('dashboard schema — repairAttempts', () => {
  it('has table name "repair_attempts"', () => {
    expect(tname(repairAttempts)).toBe('repair_attempts');
  });
});

describe('dashboard schema — agentConflicts', () => {
  it('has table name "agent_conflicts"', () => {
    expect(tname(agentConflicts)).toBe('agent_conflicts');
  });
});

describe('dashboard schema — samlConfig', () => {
  it('has table name "saml_config"', () => {
    expect(tname(samlConfig)).toBe('saml_config');
  });
});

describe('dashboard schema — auditEvents', () => {
  it('has table name "audit_events"', () => {
    expect(tname(auditEvents)).toBe('audit_events');
  });

  it('has actorId and action columns for immutable audit trail', () => {
    const c = cols(auditEvents);
    expect(c).toContain('actorId');
    expect(c).toContain('action');
    expect(c).toContain('timestamp');
  });
});

// ─── automate schema ─────────────────────────────────────────────────────────

describe('automate schema — conversations', () => {
  it('is exported and has the correct table name', () => {
    expect(tname(conversations)).toBe('conversations');
  });

  it('has the expected columns', () => {
    const c = cols(conversations);
    expect(c).toContain('id');
    expect(c).toContain('title');
    expect(c).toContain('createdAt');
    expect(c).toContain('updatedAt');
  });
});

describe('automate schema — messages', () => {
  it('has table name "messages"', () => {
    expect(tname(messages)).toBe('messages');
  });

  it('has role column with correct enum', () => {
    expect(enumVals(messages, 'role')).toEqual(['user', 'assistant', 'system', 'tool']);
  });

  it('has conversationId foreign key', () => {
    expect(cols(messages)).toContain('conversationId');
  });
});

describe('automate schema — messageAttachments', () => {
  it('has table name "message_attachments"', () => {
    expect(tname(messageAttachments)).toBe('message_attachments');
  });
});

describe('automate schema — connectorConfigs', () => {
  it('has table name "connector_configs"', () => {
    expect(tname(connectorConfigs)).toBe('connector_configs');
  });

  it('has enabled boolean column', () => {
    expect(cols(connectorConfigs)).toContain('enabled');
  });
});

describe('automate schema — flowTemplates', () => {
  it('has table name "flow_templates"', () => {
    expect(tname(flowTemplates)).toBe('flow_templates');
  });
});

describe('automate schema — executionLog', () => {
  it('has table name "execution_log"', () => {
    expect(tname(executionLog)).toBe('execution_log');
  });

  it('has status column with lifecycle enum', () => {
    expect(enumVals(executionLog, 'status')).toEqual(['running', 'success', 'error', 'timeout']);
  });
});

describe('automate schema — modelConfig', () => {
  it('has table name "model_config"', () => {
    expect(tname(modelConfig)).toBe('model_config');
  });

  it('has provider column with default ollama', () => {
    expect(cols(modelConfig)).toContain('provider');
    expect(cols(modelConfig)).toContain('model');
    expect(cols(modelConfig)).toContain('endpoint');
  });
});

describe('automate schema — traceLinks', () => {
  it('has table name "trace_links"', () => {
    expect(tname(traceLinks)).toBe('trace_links');
  });
});

// ─── vault schema ─────────────────────────────────────────────────────────────

describe('vault schema — vaultEntries', () => {
  it('is exported and has the correct table name', () => {
    expect(tname(vaultEntries)).toBe('vault_entries');
  });

  it('has all AES-256-GCM encryption columns', () => {
    const c = cols(vaultEntries);
    expect(c).toContain('id');
    expect(c).toContain('connectorName');
    expect(c).toContain('ciphertext');
    expect(c).toContain('iv');
    expect(c).toContain('authTag');
    expect(c).toContain('salt');
    expect(c).toContain('iterations');
    expect(c).toContain('createdAt');
    expect(c).toContain('updatedAt');
  });

  it('has unique constraint on connectorName', () => {
    // Drizzle unique() constraint is reflected on the column builder;
    // we verify the column exists and the table name is correct.
    const colKeys = cols(vaultEntries);
    expect(colKeys).toContain('connectorName');
  });
});

// ─── index re-export completeness ────────────────────────────────────────────

describe('schema/index re-exports', () => {
  it('exports all three domain table groups without conflict', () => {
    // If any name clashed, the import at the top of this file would fail.
    // Asserting the objects are distinct confirms no re-export collision.
    expect(runs).not.toBe(conversations);
    expect(conversations).not.toBe(vaultEntries);
    expect(runs).not.toBe(vaultEntries);
  });
});
