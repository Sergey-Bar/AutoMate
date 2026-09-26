import { getTableColumns, getTableName, isTable, type Table } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from './index.js';
import {
  auditEvents,
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

  it('exports outbox and legacy map tables', () => {
    expect(getTableName(outboxEvents)).toBe('outbox_events');
    expect(getTableColumns(outboxEvents)).toHaveProperty('dedupeKey');
    expect(getTableName(legacyIdMap)).toBe('legacy_id_map');
  });

  it('has exactly one audit table, and it is the attributable one', () => {
    // `system_audit_events` was a strict subset of `audit_events` with no writer,
    // and its indexes were named as though they belonged to `audit_events`.
    // Migration 0010 dropped it. If a second audit table reappears, this is the
    // assertion that will say so.
    //
    // `isTable` rather than duck-typing `name`: a Drizzle table's `name` is its
    // symbol name, not its SQL table name, and several exports share one. The
    // predicate widens to `unknown` because the barrel also exports enums and
    // types, and `Table` is not assignable to the narrowed union of those.
    const auditTables = Object.values(schema as Record<string, unknown>)
      .filter((value): value is Table => isTable(value))
      .map((table) => getTableName(table))
      .filter((tableName) => tableName.endsWith('audit_events'))
      .sort();
    expect(auditTables).toEqual(['audit_events']);

    // And the surviving table keeps the four columns that made it attributable.
    const columns = getTableColumns(auditEvents);
    for (const column of ['ip', 'userAgent', 'tenantId', 'workspaceId', 'requestId', 'details']) {
      expect(columns, `audit_events lost ${column}`).toHaveProperty(column);
    }
  });
});
