import { afterEach, describe, expect, it } from 'vitest';
import { migratedDatabase } from '../test-support/migrated-database.js';
import {
  deleteTriageLabel,
  labelClusters,
  listTriageLabels,
  setTriageLabel,
} from './triage-label-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const options = { db: db as never, workspaceId: 'ws-1' };
  return { options, other: { ...options, workspaceId: 'ws-2' } };
}

const SIGNATURE = 'timeouterror: timeout <n>ms exceeded @ pay < checkout';

describe('triage labels', () => {
  it('labels a signature once, replaces the label on a second write, and deletes it', async () => {
    const { options } = await setup();
    await setTriageLabel(options, { signature: SIGNATURE, category: 'environment' }, 'user:ana');
    const replaced = await setTriageLabel(
      options,
      { signature: SIGNATURE, category: 'known-issue', issueUrl: 'https://tracker.example/T-1' },
      'user:ana',
    );
    expect(replaced).toMatchObject({
      signature: SIGNATURE,
      category: 'known-issue',
      issueUrl: 'https://tracker.example/T-1',
      labelledBy: 'user:ana',
    });
    expect(await listTriageLabels(options)).toHaveLength(1);
    expect(await deleteTriageLabel(options, SIGNATURE)).toBe(true);
    expect(await deleteTriageLabel(options, SIGNATURE)).toBe(false);
    expect(await listTriageLabels(options)).toEqual([]);
  });

  it("never reads, replaces or deletes another workspace's label", async () => {
    const { options, other } = await setup();
    await setTriageLabel(options, { signature: SIGNATURE, category: 'product' }, 'user:ana');
    expect(await listTriageLabels(other)).toEqual([]);
    await setTriageLabel(other, { signature: SIGNATURE, category: 'test' }, 'user:bo');
    expect(await deleteTriageLabel(other, SIGNATURE)).toBe(true);
    const [mine] = await listTriageLabels(options);
    expect(mine?.category).toBe('product');
  });

  it('labels the clusters a signature matches and counts the failures nobody labelled', async () => {
    const { options } = await setup();
    await setTriageLabel(options, { signature: SIGNATURE, category: 'environment' }, 'user:ana');
    const labelled = labelClusters(
      {
        clusters: [
          { signature: SIGNATURE, count: 3 },
          { signature: 'assertionerror: expected <n> to be <n>', count: 2 },
        ],
        totals: { failures: 5, causes: 2 },
      },
      await listTriageLabels(options),
    );
    expect(labelled.clusters.map((cluster) => cluster.label)).toEqual([
      { category: 'environment', issueUrl: null },
      null,
    ]);
    expect(labelled.totals.unlabelled).toBe(2);
  });
});
