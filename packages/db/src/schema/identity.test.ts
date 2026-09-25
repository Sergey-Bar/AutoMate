import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  systemAuditEvents,
  installationKeys,
  installations,
  legacyIdMap,
  outboxEvents,
  runnerEnrollmentTokens,
  runnerIdentities,
  serviceCredentials,
  sessions,
} from './index.js';

describe('identity and system schema', () => {
  it('exports installation credential and session tables', () => {
    expect(getTableName(installations)).toBe('installations');
    expect(getTableName(installationKeys)).toBe('installation_keys');
    expect(getTableName(sessions)).toBe('sessions');
    expect(getTableColumns(sessions)).toHaveProperty('tokenHash');
    expect(getTableColumns(sessions)).toHaveProperty('revokedAt');
  });

  it('exports runner identity and enrollment tables', () => {
    expect(getTableName(runnerIdentities)).toBe('runner_identities');
    expect(getTableName(runnerEnrollmentTokens)).toBe('runner_enrollment_tokens');
    expect(getTableName(serviceCredentials)).toBe('service_credentials');
  });

  it('exports outbox, legacy map, and audit tables', () => {
    expect(getTableName(outboxEvents)).toBe('outbox_events');
    expect(getTableColumns(outboxEvents)).toHaveProperty('dedupeKey');
    expect(getTableName(legacyIdMap)).toBe('legacy_id_map');
    expect(getTableName(systemAuditEvents)).toBe('system_audit_events');
  });
});
