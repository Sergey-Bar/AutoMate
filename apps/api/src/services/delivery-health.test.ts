import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import type { Scorecard } from '@automate/shared-contracts';
import { migratedDatabase } from '../test-support/migrated-database.js';
import {
  branchGrade,
  healthGate,
  type DeliveryReading,
  type RepoHealthOptions,
} from './repo-health-service.js';

/**
 * Delivery as the health grade and the pull-request gate read it.
 *
 * The DORA scorecard is the `delivery` dimension's metric, and `delivery` is opt-in: measured
 * and shown, but counted only when a policy weights it (HEALTH-3). `gateOnDelivery` is what
 * lets a failing scorecard fail a pull request.
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

function card(status: Scorecard['status'], score: number | null): Scorecard {
  return {
    id: 'delivery',
    title: 'Software delivery (DORA)',
    dimension: 'delivery',
    evaluatedAt: '2026-10-23T12:00:00.000Z',
    windowDays: 30,
    status,
    score,
    cappedBy: score === null ? null : 'change-failure-rate',
    metrics: [],
    reasons:
      status === 'fail' ? ['Change failure rate is 40%, above the policy maximum of 15%.'] : [],
  };
}

function reading(dora: Scorecard, gateOnDelivery = false): DeliveryReading {
  return {
    dora,
    gateOnDelivery,
    metric:
      dora.score === null
        ? null
        : {
            dimension: 'delivery',
            metric: 'dora',
            tool: { name: 'automate-delivery', version: null },
            score: dora.score,
            summary: `DORA ${String(dora.score)} / 100`,
          },
  };
}

async function setup(health: Record<string, unknown>, delivery: DeliveryReading | null) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const [project] = await db
    .insert(schema.projects)
    .values({
      workspaceId: 'ws-1',
      name: 'Service',
      slug: 'service',
      defaultBranch: 'main',
      profile: { health },
    })
    .returning({ id: schema.projects.id });
  // Security measured, so the grade has something besides delivery.
  const tests = {
    metric: {
      dimension: 'tests' as const,
      metric: 'qa score',
      tool: { name: 'automate', version: null },
      score: 90,
      summary: 'QA score 90',
    },
    failingTests: 0,
  };
  const options: RepoHealthOptions = {
    db: db as never,
    workspaceId: 'ws-1',
    testsReading: async () => tests,
    deliveryReading: async () => delivery,
  };
  return { options, projectId: (project as { id: string }).id };
}

const deliveryDimension = (grade: Awaited<ReturnType<typeof branchGrade>>) =>
  grade.dimensions.find((entry) => entry.dimension === 'delivery');

describe('delivery in the grade', () => {
  it('measures delivery on the default branch, and counts it only when a policy weights it', async () => {
    const unweighted = await setup({}, reading(card('pass', 40)));
    const plain = await branchGrade(unweighted.options, unweighted.projectId, 'main');
    expect(deliveryDimension(plain)).toMatchObject({ measured: true, score: 40, weight: 0 });

    const weighted = await setup({ weights: { delivery: 50 } }, reading(card('pass', 40)));
    const counted = await branchGrade(weighted.options, weighted.projectId, 'main');
    expect(deliveryDimension(counted)?.weight).toBe(50);
    // How a weight changes the score is the grade's own invariant (HEALTH-3, proven in
    // `grade-opt-in.property.test.ts`); here the reading only has to reach it, with the weight.
    expect(deliveryDimension(counted)?.summary.join(' ')).toContain('DORA 40 / 100');
  });

  it('leaves delivery unmeasured with too little data, and off a feature branch', async () => {
    const { options, projectId } = await setup(
      { weights: { delivery: 50 } },
      reading(card('insufficient', null)),
    );
    expect(deliveryDimension(await branchGrade(options, projectId, 'main'))?.measured).toBe(false);
    const other = await setup({ weights: { delivery: 50 } }, reading(card('pass', 40)));
    expect(
      deliveryDimension(await branchGrade(other.options, other.projectId, 'feature'))?.measured,
    ).toBe(false);
  });
});

describe('delivery in the pull-request gate', () => {
  it('fails the gate on a failing DORA scorecard only when the policy gates on delivery', async () => {
    const gated = await setup(
      { delivery: { gateOnDelivery: true } },
      reading(card('fail', 50), true),
    );
    const failed = await healthGate(gated.options, gated.projectId, 'feature');
    expect(failed.verdict.verdict).toBe('failed');
    expect(failed.verdict.reasons).toContain(
      'Delivery: Change failure rate is 40%, above the policy maximum of 15%.',
    );
    expect(failed.delivery?.status).toBe('fail');

    const ungated = await setup({}, reading(card('fail', 50), false));
    const passed = await healthGate(ungated.options, ungated.projectId, 'feature');
    expect(passed.verdict.verdict).toBe('passed');
    // Still returned, so the GitHub comment can show its DORA line.
    expect(passed.delivery?.score).toBe(50);
  });

  it('returns no delivery when none is read', async () => {
    const { options, projectId } = await setup({}, null);
    expect((await healthGate(options, projectId, 'feature')).delivery).toBeNull();
  });
});
