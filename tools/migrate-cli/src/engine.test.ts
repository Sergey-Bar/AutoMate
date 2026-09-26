import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createPlan, readPlan, validatePlan, writePlan } from './engine.js';
import { MigrationStateStore } from './state.js';
import { reconcileCounts } from './reconcile.js';

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
