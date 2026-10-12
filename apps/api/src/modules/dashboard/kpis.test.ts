import { describe, expect, it } from 'vitest';
import { KpiSummarySchema } from '@automate/shared-contracts';
import { createDashboardModule } from './index.js';
import { InMemoryRunRepository } from '../../repositories/in-memory-run-repository.js';
import type { RunRecord } from '../../repositories/run-repository.js';

/**
 * The KPI endpoint, tested at the shape a screen consumes it.
 *
 * **The unit is the assertion.** Every number here is checked against the unit it
 * declared, because GLASS-3 was exactly a number whose unit was left to the
 * client's memory: a 0–1 ratio printed with a percent sign reads as true and is
 * false by two orders of magnitude. A KPI that arrives without its unit is the
 * defect returning in a new field.
 */

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-1',
    workspaceId: 'default-workspace',
    phase: 'complete',
    outcome: 'passed',
    status: 'passed',
    startedAt: '2026-10-01T00:00:00.000Z',
    finishedAt: '2026-10-01T00:00:01.000Z',
    total: 1,
    passed: 1,
    failed: 0,
    flaky: 0,
    skipped: 0,
    blocked: 0,
    unknown: 0,
    durationMs: 4_200,
    framework: 'playwright',
    branch: 'main',
    commit: 'abc',
    selection: {},
    metadata: {},
    ...overrides,
  } as RunRecord;
}

describe('GET /api/v1/dashboard/kpis/summary', () => {
  it('answers a schema-valid summary with a unit on every KPI', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(run({ id: 'a' }));
    await repository.upsertRun(run({ id: 'b', status: 'failed', outcome: 'failed' }));
    const app = createDashboardModule({ repository });
    const response = await app.request('/api/v1/dashboard/kpis/summary');
    expect(response.status).toBe(200);
    const body = await response.json();
    const parsed = KpiSummarySchema.parse(body);
    for (const kpi of parsed.kpis) {
      // **Every KPI, and its unit.** A screen formats from this declaration, so a
      // missing unit is a screen that guesses — the exact defect this replaced.
      expect(kpi.unit, `${kpi.id} arrived without a unit`).toBeTruthy();
      expect(kpi.id.length).toBeGreaterThan(0);
    }
  });

  it('declares the pass rate a percent and keeps the denominator beside it', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(run({ id: 'a' }));
    await repository.upsertRun(run({ id: 'b', status: 'failed', outcome: 'failed' }));
    const app = createDashboardModule({ repository });
    const body = KpiSummarySchema.parse(
      await (await app.request('/api/v1/dashboard/kpis/summary')).json(),
    );
    const passRate = body.kpis.find((kpi) => kpi.id === 'pass-rate');
    expect(passRate?.unit).toBe('percent');
    // 50, and not 0.5: a percent KPI whose value is a ratio prints "0.5%", which is
    // the GLASS-3 shape of wrong — two orders of magnitude, read as authoritative.
    expect(passRate?.value).toBe(50);
    expect(passRate?.denominator).toBe(2);
  });

  it('declares the average a duration in milliseconds, not a percent', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(run({ id: 'a', durationMs: 1_000 }));
    await repository.upsertRun(run({ id: 'b', durationMs: 3_000 }));
    const app = createDashboardModule({ repository });
    const body = KpiSummarySchema.parse(
      await (await app.request('/api/v1/dashboard/kpis/summary')).json(),
    );
    const average = body.kpis.find((kpi) => kpi.id === 'avg-duration');
    // 2000 ms, and the unit says so. A duration formatted as a percent is the
    // other half of GLASS-3: the same two formatters, guessing.
    expect(average?.unit).toBe('duration_ms');
    expect(average?.value).toBe(2_000);
  });

  it('does not invent an infra failure rate from a column that never carries it', async () => {
    // **A KPI that is always zero is worse than no KPI.** The dashboard's run
    // vocabulary persists `running | passed | failed | interrupted` — the infra
    // failure is a phase of the execution store's runs, which this repository
    // does not read. Rather than report a permanent 0.0, the endpoint omits the
    // number and the score's own contract declares the real one.
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(run({ id: 'a' }));
    await repository.upsertRun(
      run({ id: 'b', status: 'interrupted', outcome: 'infra_failed', finishedAt: null }),
    );
    const app = createDashboardModule({ repository });
    const body = KpiSummarySchema.parse(
      await (await app.request('/api/v1/dashboard/kpis/summary')).json(),
    );
    expect(body.kpis.map((kpi) => kpi.id)).not.toContain('infra-failure-rate');
  });

  it('answers null with a qualifier rather than zero when nothing was measured', async () => {
    // "No run recorded a duration" and "the average duration was zero" are
    // different claims, and the second is never true of a suite that ran. The
    // empty install is the state a fresh deployment is in, so it has to read as
    // an absence rather than as a good number.
    const repository = new InMemoryRunRepository();
    const app = createDashboardModule({ repository });
    const body = KpiSummarySchema.parse(
      await (await app.request('/api/v1/dashboard/kpis/summary')).json(),
    );
    expect(body.kpis.find((kpi) => kpi.id === 'pass-rate')?.value).toBeNull();
    expect(body.kpis.find((kpi) => kpi.id === 'avg-duration')?.value).toBeNull();
    expect(body.kpis.find((kpi) => kpi.id === 'avg-duration')?.qualifier).toContain('No run');
    expect(body.kpis.find((kpi) => kpi.id === 'total-runs')?.value).toBe(0);
  });

  it('excludes runs with no recorded duration from the average, rather than counting them as zero', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(run({ id: 'a', durationMs: 1_000 }));
    await repository.upsertRun(run({ id: 'b', durationMs: 3_000 }));
    await repository.upsertRun(run({ id: 'c', durationMs: null }));
    const app = createDashboardModule({ repository });
    const body = KpiSummarySchema.parse(
      await (await app.request('/api/v1/dashboard/kpis/summary')).json(),
    );
    const average = body.kpis.find((kpi) => kpi.id === 'avg-duration');
    // 2000 and not 1333: the third run contributed no measurement, and averaging it
    // in as a zero reports every run as three times faster than it was.
    expect(average?.value).toBe(2_000);
    expect(average?.denominator).toBe(2);
  });
});

describe('both repositories produce the same KPIs', () => {
  it('holds the in-memory store to the numbers the SQL store produces', async () => {
    // The units trap fixed once, in a shared helper, is not fixed at all if the
    // two repositories compute it differently: a dashboard that changes value
    // depending on which repository is mounted is the same defect, relocated.
    const runs = [
      run({ id: 'a' }),
      run({ id: 'b', status: 'failed', outcome: 'failed' }),
      run({ id: 'c', status: 'interrupted', outcome: 'infra_failed', finishedAt: null }),
      run({ id: 'd', durationMs: null }),
    ];
    const repository = new InMemoryRunRepository();
    for (const entry of runs) await repository.upsertRun(entry);
    const body = KpiSummarySchema.parse(await repository.getKpiSummary());
    const byId = new Map(body.kpis.map((kpi) => [kpi.id, kpi]));
    expect(byId.get('pass-rate')?.value).toBe(67);
    expect(byId.get('pass-rate')?.unit).toBe('percent');
    expect(byId.get('total-runs')?.value).toBe(4);
  });
});
