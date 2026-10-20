import assert from 'node:assert/strict';
import test from 'node:test';
import { ingest } from '../src/ingest.mjs';
import { reconcile } from '../src/reconcile.mjs';
import { bytesFor, loadManifest, optionsFor } from './support.mjs';

const manifest = loadManifest();

/**
 * Ingests corpus fixtures by id into the shape `reconcile` takes.
 *
 * @param {string[]} ids
 * @param {Record<string, Record<string, string | undefined>>} [contextOverrides]
 */
function items(ids, contextOverrides = {}) {
  return ids.map((id) => {
    const entry = manifest.find((candidate) => candidate.id === id);
    assert.ok(entry, `no fixture ${id}`);
    const { artifact, result } = ingest(bytesFor(entry), optionsFor(entry));
    return {
      id,
      sha256: artifact.sha256,
      result,
      context: { ...entry.context, ...contextOverrides[id] },
    };
  });
}

test('byte-identical files are one artifact and are counted once', () => {
  const out = reconcile(items(['junit-basic', 'junit-basic-copy']));
  assert.deepEqual(out.duplicates, [{ ids: ['junit-basic', 'junit-basic-copy'] }]);
  assert.equal(out.groups.length, 1);
  assert.equal(out.aggregate.tests, 4, 'four tests, not eight');
});

test('one execution reported in two formats is one group and is not double counted', () => {
  const out = reconcile(items(['pair-junit', 'pair-playwright']));
  assert.equal(out.groups.length, 1);
  const [group] = out.groups;
  assert.equal(group?.kind, 'same-execution');
  assert.equal(group?.confidence, 'medium');
  assert.deepEqual(group?.members, ['pair-junit', 'pair-playwright']);
  assert.equal(group?.primary, 'pair-playwright', 'the framework-native report ranks first');
  assert.equal(group?.status, 'agreed');
  assert.equal(out.aggregate.tests, 3, 'three tests, not six');
  assert.deepEqual(out.disagreements, []);
});

test('contradictory reports produce a disagreement and no silent winner', () => {
  const out = reconcile(items(['contradict-junit', 'contradict-playwright']));
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0]?.status, 'contested');
  assert.deepEqual(out.disagreements, [
    {
      testKey: 'tests/checkout.spec.ts::pays',
      sources: [
        { id: 'contradict-junit', format: 'junit-xml', outcome: 'passed' },
        { id: 'contradict-playwright', format: 'playwright-json', outcome: 'failed' },
      ],
      chosen: null,
    },
  ]);
});

test('reports from different commits are labelled incomparable, not merged', () => {
  const out = reconcile(items(['pair-junit-other-commit', 'pair-playwright']));
  assert.equal(out.groups.length, 2);
  assert.deepEqual(out.incomparable, [
    { a: 'pair-junit-other-commit', b: 'pair-playwright', reason: 'different-commit' },
  ]);
  assert.equal(out.aggregate.tests, 6, 'both are kept, and neither is dropped');
});

test('an unknown commit still allows grouping, at low confidence and with the limit stated', () => {
  const out = reconcile(
    items(['pair-junit', 'pair-playwright'], { 'pair-junit': { commit: undefined } }),
  );
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0]?.confidence, 'low');
  assert.ok(out.groups[0]?.limits.includes('commit-unknown'));
});

test('reports observed far apart in time are not grouped', () => {
  const out = reconcile(
    items(['pair-junit', 'pair-playwright'], {
      'pair-junit': { observedAt: '2026-10-17T10:00:00Z' },
    }),
  );
  assert.equal(out.groups.length, 2);
  assert.equal(
    out.groups.every((group) => group.members.length === 1),
    true,
  );
});

test('reports with no tests in common are not grouped, even from one commit', () => {
  const out = reconcile(
    items(['junit-basic', 'pair-playwright'], {
      'junit-basic': { commit: '4a5b6c7', observedAt: '2026-10-18T10:00:10Z' },
    }),
  );
  assert.equal(out.groups.length, 2);
});

test('shards of one run are added together, and a missing shard makes the run partial', () => {
  const both = reconcile(items(['junit-shard-1', 'junit-shard-2']));
  assert.equal(both.groups.length, 1);
  assert.equal(both.groups[0]?.kind, 'shards');
  assert.equal(both.groups[0]?.confidence, 'high');
  assert.equal(both.groups[0]?.completeness, 'complete');
  assert.equal(both.aggregate.tests, 4);

  const one = reconcile(items(['junit-shard-1']));
  assert.equal(one.groups[0]?.completeness, 'partial');
  assert.ok(one.groups[0]?.limits.includes('shards-missing:1/2'));
});

test('retries inside one report stay attempts and are never treated as duplicates', () => {
  const out = reconcile(items(['playwright-retries', 'junit-surefire-flaky']));
  assert.deepEqual(out.duplicates, []);
  assert.equal(out.groups.length, 2);
  assert.equal(out.aggregate.attempts, 13, 'six Playwright attempts and seven JUnit attempts');
});

test('unreadable input is listed, not dropped', () => {
  const out = reconcile(items(['junit-basic', 'junit-truncated', 'not-a-report']));
  assert.deepEqual(out.unreadable, [{ id: 'not-a-report', reason: 'unrecognised-format' }]);
  assert.equal(out.groups.length, 2, 'the truncated report is still a report');
});
