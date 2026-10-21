import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createPlan, readPlan, validatePlan, writePlan } from './engine.js';
import { MigrationStateStore } from './state.js';
import { reconcileCounts } from './reconcile.js';
import { buildPlan, type MigrationPlan } from './plan.js';

describe('migration engine control plane', () => {
  it('creates and reloads a deterministic catalog plan', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'automate-migration-'));
    try {
      const source = path.join(directory, 'source.db');
      const database = new Database(source);
      database.exec(
        "CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT); INSERT INTO runs VALUES ('r1', 'passed')",
      );
      database.close();
      const plan = createPlan({
        source,
        sourceId: 'fixture',
        sourceCommit: 'source-sha',
        targetCommit: 'target-sha',
      });
      expect(plan.catalogFingerprint).toHaveLength(64);
      expect(() => validatePlan(plan)).not.toThrow();
      const planPath = path.join(directory, 'plan.json');
      writePlan(planPath, plan);
      expect(readPlan(planPath).catalogFingerprint).toBe(plan.catalogFingerprint);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  describe('validatePlan refusals', () => {
    const base = buildPlan({
      sourceId: 's',
      sourceCommit: 'a',
      targetCommit: 'b',
      toolVersion: '0.2.0',
      tables: [{ name: 'runs', rowCount: 1, columns: ['id'] }],
    });

    it('accepts the unmodified plan', () => {
      expect(() => validatePlan(base)).not.toThrow();
    });

    it('refuses a plan version other than 1', () => {
      const plan = { ...base, planVersion: 2 } as unknown as MigrationPlan;
      expect(() => validatePlan(plan)).toThrow('Unsupported migration plan version');
    });

    it.each(['', 'abc', 'A'.repeat(64), `${'a'.repeat(64)}0`])(
      'refuses the fingerprint %j',
      (catalogFingerprint) => {
        expect(() => validatePlan({ ...base, catalogFingerprint })).toThrow(
          'Invalid catalog fingerprint',
        );
      },
    );

    it('refuses a plan with a blocked table', () => {
      const plan = buildPlan({
        sourceId: 's',
        sourceCommit: 'a',
        targetCommit: 'b',
        toolVersion: '0.2.0',
        tables: [
          { name: 'runs', rowCount: 1, columns: ['id'] },
          { name: 'saml_config', rowCount: 1, columns: ['id'] },
        ],
      });
      expect(plan.tables[1]?.disposition).toBe('blocked');
      expect(() => validatePlan(plan)).toThrow('Plan contains blocked tables');
    });

    it('accepts a dormant table, which is retained rather than blocked', () => {
      const plan = buildPlan({
        sourceId: 's',
        sourceCommit: 'a',
        targetCommit: 'b',
        toolVersion: '0.2.0',
        tables: [{ name: 'predictions', rowCount: 4, columns: ['id'] }],
      });
      expect(plan.tables[0]?.disposition).toBe('retain-dormant');
      expect(() => validatePlan(plan)).not.toThrow();
    });

    it('refuses vault entries without a key reference, and only then', () => {
      expect(() => validatePlan({ ...base, vault: { ...base.vault, count: 2 } })).toThrow(
        'Vault entries require a key reference',
      );
      expect(() =>
        validatePlan({ ...base, vault: { ...base.vault, count: 2, keyReference: 'kms:key/1' } }),
      ).not.toThrow();
      expect(() => validatePlan({ ...base, vault: { ...base.vault, count: 0 } })).not.toThrow();
    });
  });

  it('persists resumable state and reports count discrepancies', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'automate-state-'));
    try {
      const statePath = path.join(directory, 'state.json');
      const store = new MigrationStateStore(statePath);
      store.write({
        planFingerprint: 'f',
        completedWaves: ['foundation'],
        rowDigests: {},
        artifactTransfers: {},
        vaultTransfers: {},
      });
      expect(store.read().completedWaves).toEqual(['foundation']);
      expect(reconcileCounts({ runs: 1 }, { runs: 0 })).toEqual({
        ok: false,
        discrepancies: ['runs: source=1 target=0'],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
