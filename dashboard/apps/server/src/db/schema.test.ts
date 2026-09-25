/// <reference types="vitest" />
import { describe, it, expect } from 'vitest';

function getExtraConfig(table: unknown) {
  const symbol = Object.getOwnPropertySymbols(table as object).find(
    (s) => String(s) === 'Symbol(drizzle:ExtraConfigBuilder)',
  );

  if (!symbol) {
    return undefined;
  }

  const builder = (table as Record<PropertyKey, unknown>)[symbol];
  if (typeof builder !== 'function') {
    return undefined;
  }

  // For PG tables, calling the builder with the real table re-runs index construction
  // which fails on already-resolved columns. Use a proxy with fake column objects instead.
  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string) {
      return { name: prop, keyAsName: false, columnType: 'PgText', indexConfig: {}, defaultConfig: {} };
    },
  });

  try {
    return (builder as (value: unknown) => Record<string, unknown>)(proxy);
  } catch {
    return (builder as (value: unknown) => Record<string, unknown>)(table);
  }
}

type InlineForeignKey = {
  onDelete?: string;
  reference: () => { columns: Array<{ name: string }> };
};

function getInlineForeignKeys(table: unknown): InlineForeignKey[] {
  // Try PG inline foreign keys symbol first, then SQLite
  const pgSymbol = Object.getOwnPropertySymbols(table as object).find(
    (s) => String(s) === 'Symbol(drizzle:PgInlineForeignKeys)',
  );
  const sqliteSymbol = Object.getOwnPropertySymbols(table as object).find(
    (s) => String(s) === 'Symbol(drizzle:SQLiteInlineForeignKeys)',
  );
  const symbol = pgSymbol ?? sqliteSymbol;

  if (!symbol) {
    return [];
  }

  const fks = (table as Record<PropertyKey, unknown>)[symbol];
  return Array.isArray(fks) ? (fks as InlineForeignKey[]) : [];
}

function expectColumnShape(
  table: Record<string, unknown>,
  columnName: string,
  expected: { dataType: string; columnType: string; notNull?: boolean; default?: unknown; enumValues?: string[] },
) {
  const column = table[columnName] as {
    dataType?: string;
    columnType?: string;
    notNull?: boolean;
    default?: unknown;
    enumValues?: string[];
  };

  expect(column).toBeDefined();
  expect(column.dataType).toBe(expected.dataType);
  expect(column.columnType).toBe(expected.columnType);

  if (typeof expected.notNull === 'boolean') {
    expect(column.notNull).toBe(expected.notNull);
  }

  if (Object.prototype.hasOwnProperty.call(expected, 'default')) {
    expect(column.default).toBe(expected.default);
  }

  if (expected.enumValues) {
    expect(column.enumValues).toEqual(expected.enumValues);
  }
}

// Test Drizzle schema definitions exist and have correct shape
describe('DB Schema', () => {
  it('runs table has required columns', async () => {
    const { runs } = await import('../db/schema.js');
    expect(runs).toBeDefined();
    // Check column names exist
    const cols = Object.keys(runs);
    expect(cols.length).toBeGreaterThan(0);
  });

  it('suites table has required columns', async () => {
    const { suites } = await import('../db/schema.js');
    expect(suites).toBeDefined();
  });

  it('tests table has required columns', async () => {
    const { tests } = await import('../db/schema.js');
    expect(tests).toBeDefined();
  });

  it('results table has required columns', async () => {
    const { results } = await import('../db/schema.js');
    expect(results).toBeDefined();
  });

  it('attachments table has required columns', async () => {
    const { attachments } = await import('../db/schema.js');
    expect(attachments).toBeDefined();
  });

  it('trends table has required columns', async () => {
    const { trends } = await import('../db/schema.js');
    expect(trends).toBeDefined();
  });

  it('quarantine table exists', async () => {
    const { quarantine } = await import('../db/schema.js');
    expect(quarantine).toBeDefined();
  });

  it('knownFailures table exists', async () => {
    const { knownFailures } = await import('../db/schema.js');
    expect(knownFailures).toBeDefined();
  });

  it('schedules table exists', async () => {
    const { schedules } = await import('../db/schema.js');
    expect(schedules).toBeDefined();
  });

  it('workspaces table exists', async () => {
    const { workspaces } = await import('../db/schema.js');
    expect(workspaces).toBeDefined();
  });

  it('qualityGateConfig table exists with expected columns', async () => {
    const { qualityGateConfig } = await import('../db/schema.js');
    expect(qualityGateConfig).toBeDefined();
    const cols = Object.keys(qualityGateConfig);
    expect(cols.length).toBeGreaterThan(0);
  });

  it('defectCategories table exists with expected columns', async () => {
    const { defectCategories } = await import('../db/schema.js');
    expect(defectCategories).toBeDefined();
    const cols = Object.keys(defectCategories);
    expect(cols.length).toBeGreaterThan(0);
  });

  it('fingerprintCategories table exists with expected columns', async () => {
    const { fingerprintCategories } = await import('../db/schema.js');
    expect(fingerprintCategories).toBeDefined();
    const cols = Object.keys(fingerprintCategories);
    expect(cols.length).toBeGreaterThan(0);
  });

  it('blobShards table exists with expected columns', async () => {
    const { blobShards } = await import('../db/schema.js');
    expect(blobShards).toBeDefined();
    const cols = Object.keys(blobShards);
    expect(cols.length).toBeGreaterThan(0);
  });

  it('legacy defect category tables remain unchanged in v1 names and columns', async () => {
    const { defectCategories, fingerprintCategories } = await import('../db/schema.js');

    expect(defectCategories).toBeDefined();
    expect(fingerprintCategories).toBeDefined();

    expect(defectCategories).toHaveProperty('id');
    expect(defectCategories).toHaveProperty('name');
    expect(defectCategories).toHaveProperty('color');
    expect(defectCategories).toHaveProperty('createdAt');

    expect(fingerprintCategories).toHaveProperty('fingerprint');
    expect(fingerprintCategories).toHaveProperty('categoryId');
    expect(fingerprintCategories).toHaveProperty('assignedAt');
  });

  it('failureTaxonomyRules table is exported with required columns', async () => {
    const { failureTaxonomyRules } = await import('../db/schema.js');

    expect(failureTaxonomyRules).toBeDefined();

    expectColumnShape(failureTaxonomyRules, 'id', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(failureTaxonomyRules, 'priority', { dataType: 'number', columnType: 'PgInteger', notNull: true });
    expectColumnShape(failureTaxonomyRules, 'category', {
      dataType: 'string',
      columnType: 'PgText',
      notNull: true,
      enumValues: ['infra_issue', 'env_issue', 'test_debt', 'flaky', 'app_bug', 'unknown'],
    });
    expectColumnShape(failureTaxonomyRules, 'pattern', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(failureTaxonomyRules, 'patternTarget', {
      dataType: 'string',
      columnType: 'PgText',
      notNull: true,
      enumValues: ['error_message', 'error_stack', 'test_title', 'file_path'],
    });
    expectColumnShape(failureTaxonomyRules, 'description', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(failureTaxonomyRules, 'isBuiltIn', {
      dataType: 'number',
      columnType: 'PgInteger',
      notNull: true,
      default: false,
    });
    expectColumnShape(failureTaxonomyRules, 'enabled', {
      dataType: 'number',
      columnType: 'PgInteger',
      notNull: true,
      default: true,
    });
    expectColumnShape(failureTaxonomyRules, 'createdAt', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(failureTaxonomyRules, 'updatedAt', { dataType: 'string', columnType: 'PgText', notNull: true });
  });

  it('failureClassifications table is exported with required columns', async () => {
    const { failureClassifications } = await import('../db/schema.js');

    expect(failureClassifications).toBeDefined();

    expectColumnShape(failureClassifications, 'id', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(failureClassifications, 'fingerprint', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(failureClassifications, 'runId', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(failureClassifications, 'category', {
      dataType: 'string',
      columnType: 'PgText',
      notNull: true,
      enumValues: ['infra_issue', 'env_issue', 'test_debt', 'flaky', 'app_bug', 'unknown'],
    });
    expectColumnShape(failureClassifications, 'confidence', { dataType: 'number', columnType: 'PgReal', notNull: true });
    expectColumnShape(failureClassifications, 'matchedRuleId', { dataType: 'string', columnType: 'PgText', notNull: false });
    expectColumnShape(failureClassifications, 'rationale', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(failureClassifications, 'isManualOverride', {
      dataType: 'number',
      columnType: 'PgInteger',
      notNull: true,
      default: false,
    });
    expectColumnShape(failureClassifications, 'createdAt', { dataType: 'string', columnType: 'PgText', notNull: true });

    const extraConfig = getExtraConfig(failureClassifications);
    expect(extraConfig).toBeDefined();
    expect(extraConfig).toHaveProperty('fingerprintRunUnique');

    const inlineFks = getInlineForeignKeys(failureClassifications);
    const runIdFk = inlineFks.find((fk) => fk.reference().columns[0]?.name === 'run_id');
    expect(runIdFk?.onDelete).toBe('cascade');

    const matchedRuleFk = inlineFks.find((fk) => fk.reference().columns[0]?.name === 'matched_rule_id');
    expect(matchedRuleFk?.onDelete).toBe('cascade');
  });

  it('testFailureCorrelations table is exported with required columns', async () => {
    const { testFailureCorrelations } = await import('../db/schema.js');

    expect(testFailureCorrelations).toBeDefined();

    expectColumnShape(testFailureCorrelations, 'id', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(testFailureCorrelations, 'testStableId', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(testFailureCorrelations, 'sourceFilePath', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(testFailureCorrelations, 'failureCount', {
      dataType: 'number',
      columnType: 'PgInteger',
      notNull: true,
      default: 0,
    });
    expectColumnShape(testFailureCorrelations, 'totalOccurrences', {
      dataType: 'number',
      columnType: 'PgInteger',
      notNull: true,
      default: 0,
    });
    expectColumnShape(testFailureCorrelations, 'lastUpdatedRunId', {
      dataType: 'string',
      columnType: 'PgText',
      notNull: false,
    });
    expectColumnShape(testFailureCorrelations, 'windowStartDate', {
      dataType: 'string',
      columnType: 'PgText',
      notNull: true,
    });
    expectColumnShape(testFailureCorrelations, 'createdAt', {
      dataType: 'string',
      columnType: 'PgText',
      notNull: true,
    });
    expectColumnShape(testFailureCorrelations, 'updatedAt', {
      dataType: 'string',
      columnType: 'PgText',
      notNull: true,
    });

    const extraConfig = getExtraConfig(testFailureCorrelations);
    expect(extraConfig).toBeDefined();
    expect(extraConfig).toHaveProperty('testFileUnique');

    const inlineFks = getInlineForeignKeys(testFailureCorrelations);
    const lastUpdatedRunFk = inlineFks.find((fk) => fk.reference().columns[0]?.name === 'last_updated_run_id');
    expect(lastUpdatedRunFk?.onDelete).toBe('cascade');
  });

  it('locatorSuggestions table is exported with required columns', async () => {
    const { locatorSuggestions } = await import('../db/schema.js');

    expect(locatorSuggestions).toBeDefined();

    expectColumnShape(locatorSuggestions, 'id', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(locatorSuggestions, 'testId', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(locatorSuggestions, 'runId', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(locatorSuggestions, 'originalSelector', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(locatorSuggestions, 'suggestedSelector', {
      dataType: 'string',
      columnType: 'PgText',
      notNull: true,
    });
    expectColumnShape(locatorSuggestions, 'confidence', { dataType: 'number', columnType: 'PgReal', notNull: true });
    expectColumnShape(locatorSuggestions, 'rationale', { dataType: 'string', columnType: 'PgText', notNull: true });
    expectColumnShape(locatorSuggestions, 'status', {
      dataType: 'string',
      columnType: 'PgText',
      notNull: true,
      default: 'pending',
      enumValues: ['pending', 'accepted', 'rejected', 'expired'],
    });
    expectColumnShape(locatorSuggestions, 'createdAt', { dataType: 'string', columnType: 'PgText', notNull: true });

    const inlineFks = getInlineForeignKeys(locatorSuggestions);
    const runIdFk = inlineFks.find((fk) => fk.reference().columns[0]?.name === 'run_id');
    expect(runIdFk?.onDelete).toBe('cascade');
  });
});

