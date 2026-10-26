import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@automate/db';
import {
  DeliveryReportSchema,
  DeliverySourceSchema,
  PortfolioDeliverySchema,
  type DeliveryMarkers,
} from '@automate/shared-contracts';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  DEDUPE_WINDOW_MS,
  attributeDeployments,
  dedupeDeployments,
  deliveryReading,
  deliveryReport,
  enabledSourcesForRepository,
  getDeliverySource,
  linkIncidents,
  portfolioDelivery,
  pushDeployment,
  pushIncident,
  queueDeliverySync,
  remediationOf,
  requestDeliverySync,
  setDeliverySource,
  type DeliveryOptions,
} from './delivery-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-10-23T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

async function project(
  db: MigratedDb,
  workspaceId: string,
  extra: Partial<typeof schema.projects.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.projects)
    .values({
      workspaceId,
      name: 'Service',
      slug: `service-${String(Math.random()).slice(2, 8)}`,
      defaultBranch: 'main',
      repositoryUrl: 'https://github.com/Octo/Service.git',
      ...extra,
    })
    .returning({ id: schema.projects.id });
  return (row as { id: string }).id;
}

async function setup(profile: Record<string, unknown> = {}) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const options: DeliveryOptions = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
  return { db, options, projectId: await project(db, 'ws-1', { profile }) };
}

const MARKERS: DeliveryMarkers = {
  rollbackLabels: ['rollback', 'revert'],
  hotfixLabels: ['hotfix'],
  rollbackBranchPrefixes: ['revert-'],
  hotfixBranchPrefixes: ['hotfix/'],
};

/** A merged pull request into main, `hours` before NOW, with a merge commit. */
function mergedPr(
  db: MigratedDb,
  projectId: string,
  number: number,
  hours: number,
  extra: Partial<typeof schema.pullRequests.$inferInsert> = {},
) {
  return db.insert(schema.pullRequests).values({
    workspaceId: 'ws-1',
    projectId,
    externalId: `pr-${String(number)}`,
    number,
    state: 'merged',
    authorLogin: 'secret-author-login',
    headBranch: `feature/${String(number)}`,
    baseBranch: 'main',
    title: `Change ${String(number)}`,
    openedAt: at(-(hours + 10) * HOUR),
    firstCommitAt: at(-(hours + 12) * HOUR),
    firstReviewAt: at(-(hours + 5) * HOUR),
    approvedAt: at(-(hours + 4) * HOUR),
    mergedAt: at(-hours * HOUR),
    mergeCommitSha: `abc${String(number).padStart(4, '0')}`,
    additions: 20,
    deletions: 5,
    reviewCount: 1,
    approvalCount: 1,
    lastActivityAt: at(-hours * HOUR),
    ...extra,
  });
}

describe('the delivery source', () => {
  it('answers defaults before one is saved, and the saved source after', async () => {
    const { options, projectId } = await setup();
    const before = DeliverySourceSchema.parse(await getDeliverySource(options, projectId));
    expect(before).toMatchObject({
      configured: false,
      enabled: false,
      cadence: 'daily',
      productionEnvironments: ['production'],
      repository: { owner: 'Octo', repo: 'Service' },
      nextSyncAt: null,
    });
    const saved = await setDeliverySource(options, projectId, {
      enabled: true,
      cadence: 'hourly',
      productionEnvironments: ['prod', 'production'],
      markers: { hotfixLabels: ['urgent'] },
      deployWorkflows: ['Deploy'],
    });
    expect(saved).toMatchObject({
      configured: true,
      enabled: true,
      cadence: 'hourly',
      productionEnvironments: ['prod', 'production'],
      deployWorkflows: ['Deploy'],
      // Enabling makes it due now, so the first sync does not wait for the cadence.
      nextSyncAt: NOW.toISOString(),
    });
    expect(saved.markers.hotfixLabels).toEqual(['urgent']);
    expect(saved.markers.rollbackBranchPrefixes).toEqual(['revert-']);
  });

  it('keeps an enabled source’s schedule when it is edited, and clears it when disabled', async () => {
    const { db, options, projectId } = await setup();
    await setDeliverySource(options, projectId, {
      enabled: true,
      cadence: 'daily',
      productionEnvironments: ['production'],
      deployWorkflows: [],
    });
    await db
      .update(schema.deliverySources)
      .set({ nextSyncAt: at(5 * HOUR) })
      .where(eq(schema.deliverySources.projectId, projectId));
    const edited = await setDeliverySource(options, projectId, {
      enabled: true,
      cadence: 'hourly',
      productionEnvironments: ['production'],
      deployWorkflows: [],
    });
    expect(edited.nextSyncAt).toBe(at(5 * HOUR).toISOString());
    const off = await setDeliverySource(options, projectId, {
      enabled: false,
      cadence: 'hourly',
      productionEnvironments: ['production'],
      deployWorkflows: [],
    });
    expect(off.nextSyncAt).toBeNull();
  });

  it('is another workspace’s project, as far as another workspace can tell, not found', async () => {
    const { options, projectId } = await setup();
    await expect(
      getDeliverySource({ ...options, workspaceId: 'ws-2' }, projectId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      setDeliverySource({ ...options, workspaceId: 'ws-2' }, projectId, {
        enabled: true,
        cadence: 'daily',
        productionEnvironments: ['production'],
        deployWorkflows: [],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      requestDeliverySync({ ...options, workspaceId: 'ws-2' }, projectId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('queueing a sync', () => {
  it('creates the source on demand, and joins a sync that is still waiting', async () => {
    const { db, options, projectId } = await setup();
    const first = await requestDeliverySync(options, projectId);
    expect(first).toMatchObject({ duplicate: false, requestedBy: 'operator' });
    const second = await requestDeliverySync(options, projectId);
    expect(second).toEqual({ syncId: first.syncId, duplicate: true, requestedBy: 'operator' });
    const rows = await db.select().from(schema.deliverySyncs);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.idempotencyKey).toMatch(/^delivery:[0-9a-f-]+:operator:[0-9a-f-]+$/u);
    // Once it is running, a new request is a new sync.
    await db.update(schema.deliverySyncs).set({ status: 'running' });
    const [source] = await db.select().from(schema.deliverySources);
    expect(
      (await queueDeliverySync(options, source as schema.DeliverySourceRow, 'webhook')).duplicate,
    ).toBe(false);
  });

  it('finds the enabled sources of a repository by name, case-insensitively, in this workspace only', async () => {
    const { db, options, projectId } = await setup();
    const other = await project(db, 'ws-2');
    const disabled = await project(db, 'ws-1');
    for (const [workspaceId, id, enabled] of [
      ['ws-1', projectId, true],
      ['ws-2', other, true],
      ['ws-1', disabled, false],
    ] as const) {
      await db.insert(schema.deliverySources).values({ workspaceId, projectId: id, enabled });
    }
    const found = await enabledSourcesForRepository(options, 'octo/service');
    expect(found.map((source) => source.projectId)).toEqual([projectId]);
    expect(await enabledSourcesForRepository(options, 'octo/other')).toEqual([]);
  });
});

describe('the push door', () => {
  const deployment = {
    externalId: 'ci-1',
    environment: 'production',
    status: 'success' as const,
    createdAt: at(-HOUR).toISOString(),
    sha: 'abc0001',
  };

  it('writes a deployment once, however often it is pushed', async () => {
    const { db, options, projectId } = await setup();
    const first = await pushDeployment(options, projectId, deployment);
    const again = await pushDeployment(options, projectId, { ...deployment, status: 'failure' });
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    const rows = await db.select().from(schema.deployments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'push', status: 'failure', workspaceId: 'ws-1' });
  });

  it('writes an incident once, keyed by its source and id', async () => {
    const { db, options, projectId } = await setup();
    const incident = {
      externalId: 'INC-1',
      source: 'pagerduty',
      openedAt: at(-2 * HOUR).toISOString(),
      title: 'Checkout is down',
    };
    expect((await pushIncident(options, projectId, incident)).created).toBe(true);
    const resolved = await pushIncident(options, projectId, {
      ...incident,
      resolvedAt: at(-HOUR).toISOString(),
      severity: 'high',
    });
    expect(resolved.created).toBe(false);
    expect(
      (await pushIncident(options, projectId, { ...incident, resolvedAt: null })).created,
    ).toBe(false);
    expect(
      (await pushIncident(options, projectId, { ...incident, source: 'opsgenie' })).created,
    ).toBe(true);
    expect(await db.select().from(schema.incidents)).toHaveLength(2);
  });

  it('refuses to write into another workspace’s project', async () => {
    const { db, options, projectId } = await setup();
    await expect(
      pushDeployment({ ...options, workspaceId: 'ws-2' }, projectId, deployment),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await db.select().from(schema.deployments)).toHaveLength(0);
  });
});

describe('deduplicating the two doors', () => {
  const row = (overrides: Partial<schema.DeploymentRow>): schema.DeploymentRow => ({
    id: overrides.externalId ?? 'id',
    workspaceId: 'ws-1',
    projectId: 'p',
    source: 'github',
    externalId: 'x',
    environment: 'production',
    status: 'success',
    createdAt: NOW,
    sha: 'abc0001',
    shas: [],
    rollback: false,
    hotfix: false,
    unplanned: false,
    url: null,
    receivedAt: NOW,
    ...overrides,
  });

  it('keeps the GitHub row of a deployment both doors reported, and maps the pushed id to it', () => {
    const github = row({ externalId: '9001' });
    const pushed = row({
      source: 'push',
      externalId: 'ci-1',
      environment: 'Production',
      createdAt: at(DEDUPE_WINDOW_MS),
    });
    const { kept, replacedBy } = dedupeDeployments([github, pushed]);
    expect(kept).toEqual([github]);
    expect(replacedBy.get('ci-1')).toBe(github);
  });

  it('keeps both when the commit, the place or the time differ', () => {
    const github = row({ externalId: '9001' });
    for (const pushed of [
      row({ source: 'push', externalId: 'a', sha: 'abc0002' }),
      row({ source: 'push', externalId: 'b', environment: 'staging' }),
      row({ source: 'push', externalId: 'c', createdAt: at(DEDUPE_WINDOW_MS + 1) }),
      row({ source: 'push', externalId: 'd', sha: null }),
    ]) {
      expect(dedupeDeployments([github, pushed]).kept, pushed.externalId).toHaveLength(2);
    }
  });

  it('credits a deployment with the merges since the previous successful production one', () => {
    const pr = (number: number, mergedHours: number, extra: Partial<schema.PullRequestRow> = {}) =>
      ({
        number,
        mergedAt: at(-mergedHours * HOUR),
        mergeCommitSha: `m${String(number)}`,
        baseBranch: 'main',
        labels: [],
        headBranch: `feature/${String(number)}`,
        ...extra,
      }) as schema.PullRequestRow;
    const prs = [
      pr(1, 50),
      pr(2, 30, { labels: ['HotFix'] }),
      pr(3, 20, { headBranch: 'revert-2-feature' }),
      pr(4, 15, { baseBranch: 'release' }),
    ];
    const attributed = attributeDeployments(
      [
        row({ id: 'd1', createdAt: at(-40 * HOUR), sha: 'd1sha' }),
        row({ id: 'failed', status: 'failure', createdAt: at(-25 * HOUR), sha: 'fsha' }),
        row({ id: 'staging', environment: 'staging', createdAt: at(-24 * HOUR), sha: 's' }),
        row({ id: 'd2', createdAt: at(-10 * HOUR), sha: 'd2sha' }),
        row({ id: 'explicit', createdAt: at(-5 * HOUR), sha: null, shas: ['m1'], unplanned: true }),
      ],
      prs,
      { production: ['production'], baseBranch: 'main', markers: MARKERS },
    );
    const byId = new Map(attributed.map((entry) => [entry.id, entry]));
    expect(byId.get('d1')?.shas).toEqual(['m1']);
    // The failed deployment ships nothing, so d2 carries everything merged after d1.
    expect(byId.get('failed')?.shas).toEqual(['m2']);
    expect(byId.get('d2')?.shas).toEqual(['m2', 'm3']);
    expect(byId.get('d2')).toMatchObject({ hotfix: true, rollback: true });
    expect(byId.get('staging')?.shas).toEqual([]);
    expect(byId.get('explicit')).toMatchObject({ shas: ['m1'], unplanned: true, hotfix: false });
  });

  it('marks a rollback or hotfix by label or by head branch prefix, case-insensitively', () => {
    expect(remediationOf({ labels: ['Rollback'], headBranch: null }, MARKERS)).toEqual({
      rollback: true,
      hotfix: false,
    });
    expect(remediationOf({ labels: [], headBranch: 'Hotfix/login' }, MARKERS)).toEqual({
      rollback: false,
      hotfix: true,
    });
    expect(
      remediationOf(
        { labels: 'not a list' as unknown as string[], headBranch: 'feature/x' },
        MARKERS,
      ),
    ).toEqual({
      rollback: false,
      hotfix: false,
    });
  });

  it('links an incident by the deployment id it names, else by its commit', () => {
    const github = row({ id: 'gh', externalId: '9001', sha: 'abc0001', createdAt: at(-3 * HOUR) });
    const later = row({ id: 'later', externalId: '9002', sha: 'abc0001', createdAt: at(HOUR) });
    const pushed = row({ id: 'p', source: 'push', externalId: 'ci-1' });
    const incident = (overrides: Partial<schema.IncidentRow>): schema.IncidentRow => ({
      id: 'i',
      workspaceId: 'ws-1',
      projectId: 'p',
      source: 'push',
      externalId: 'INC',
      openedAt: NOW,
      resolvedAt: null,
      severity: null,
      deploymentExternalId: null,
      sha: null,
      title: 't',
      receivedAt: NOW,
      ...overrides,
    });
    const linked = linkIncidents(
      [
        incident({ id: 'a', deploymentExternalId: 'ci-1' }),
        incident({ id: 'b', deploymentExternalId: '9002', resolvedAt: at(HOUR) }),
        incident({ id: 'c', sha: 'abc0001' }),
        incident({ id: 'd', sha: 'ffff' }),
        incident({ id: 'e' }),
      ],
      [github, later],
      new Map([['ci-1', github]]),
      ['production'],
    );
    expect(linked.map((entry) => [entry.id, entry.deploymentId])).toEqual([
      ['a', 'gh'],
      ['b', 'later'],
      // The latest production deployment of that commit before the incident opened.
      ['c', 'gh'],
      ['d', null],
      ['e', null],
    ]);
    expect(linked[1]?.resolvedAt).toBe(at(HOUR).toISOString());
    expect(pushed.source).toBe('push');
  });
});

describe('the delivery report', () => {
  async function seeded(profile: Record<string, unknown> = {}) {
    const context = await setup(profile);
    const { db, projectId } = context;
    // Six daily production deployments, each shipping one pull request merged two hours earlier.
    for (let day = 1; day <= 6; day += 1) {
      await mergedPr(db, projectId, day, day * 24 + 2, {
        ...(day === 3 ? { labels: ['hotfix'] } : {}),
      });
      await db.insert(schema.deployments).values({
        workspaceId: 'ws-1',
        projectId,
        source: 'github',
        externalId: `gh-${String(day)}`,
        environment: 'production',
        status: day === 2 ? 'failure' : 'success',
        createdAt: at(-day * DAY),
        sha: `abc${String(day).padStart(4, '0')}`,
      });
    }
    // CI pushed the same newest deployment, a minute later: one deployment, not two.
    await pushDeployment(context.options, projectId, {
      externalId: 'ci-1',
      environment: 'production',
      status: 'success',
      createdAt: at(-DAY + 60_000).toISOString(),
      sha: 'abc0001',
    });
    // An open pull request idle for ten days, and a draft that is ignored.
    for (const [number, draft] of [
      [100, false],
      [101, true],
    ] as const) {
      await db.insert(schema.pullRequests).values({
        workspaceId: 'ws-1',
        projectId,
        externalId: `open-${String(number)}`,
        number,
        state: 'open',
        draft,
        authorLogin: 'secret-author-login',
        title: `Waiting ${String(number)}`,
        openedAt: at(-20 * DAY),
        lastActivityAt: at(-10 * DAY),
      });
    }
    return context;
  }

  it('computes both scorecards, dedupes the doors, lists stale work, and names nobody', async () => {
    const { options, projectId } = await seeded();
    const report = DeliveryReportSchema.parse(await deliveryReport(options, projectId, 30));
    expect(report.counts).toEqual({ deployments: 6, pullRequests: 8, incidents: 0 });
    expect(report.dora.id).toBe('delivery');
    expect(report.flow.id).toBe('flow');
    expect(report.doraResult.metrics.deploymentFrequency).toMatchObject({
      status: 'measured',
      sampleSize: 5,
    });
    // One failure and one hotfix-remediated deployment out of six.
    expect(report.doraResult.metrics.changeFailureRate.value).toBeCloseTo(2 / 6, 5);
    expect(report.doraResult.metrics.changeLeadTime.status).toBe('measured');
    expect(report.stalePullRequests).toEqual([{ number: 100, title: 'Waiting 100', daysIdle: 10 }]);
    expect(report.sync).toMatchObject({ configured: false, enabled: false, latest: null });
    expect(JSON.stringify(report)).not.toContain('secret-author-login');
  });

  it('applies the policy’s limits and production environments', async () => {
    const { options, projectId } = await seeded({
      health: { delivery: { maxChangeFailureRate: 0.1, productionEnvironments: ['production'] } },
    });
    const report = await deliveryReport(options, projectId, 30);
    expect(report.dora.status).toBe('fail');
    expect(report.dora.reasons[0]).toMatch(/Change failure rate/u);
    const reading = await deliveryReading(options, projectId);
    expect(reading.gateOnDelivery).toBe(false);
    expect(reading.metric).toMatchObject({ dimension: 'delivery', metric: 'dora' });
  });

  it('says insufficient, with no score and no metric, when there is too little to measure', async () => {
    const { options, projectId } = await setup({ health: { delivery: { gateOnDelivery: true } } });
    const report = await deliveryReport(options, projectId, 30);
    expect(report.dora).toMatchObject({ status: 'insufficient', score: null });
    expect(report.flow).toMatchObject({ status: 'insufficient', score: null });
    const reading = await deliveryReading(options, projectId);
    expect(reading).toMatchObject({ metric: null, gateOnDelivery: true });
  });

  it('shows the latest sync and the source’s state', async () => {
    const { db, options, projectId } = await seeded();
    await requestDeliverySync(options, projectId);
    await db
      .update(schema.deliverySources)
      .set({ lastStatus: 'not_configured', lastError: 'No GitHub token' });
    const report = await deliveryReport(options, projectId, 30);
    expect(report.sync).toMatchObject({
      configured: true,
      lastStatus: 'not_configured',
      lastError: 'No GitHub token',
      latest: { status: 'queued', requestedBy: 'operator', errorCode: null, finishedAt: null },
    });
  });

  it('reads only this workspace’s rows, and lists only its projects in the portfolio', async () => {
    const { db, options, projectId } = await seeded();
    const theirs = await project(db, 'ws-2', { name: 'Theirs' });
    await db.insert(schema.deployments).values({
      workspaceId: 'ws-2',
      projectId: theirs,
      source: 'github',
      externalId: 'gh-x',
      environment: 'production',
      status: 'success',
      createdAt: at(-HOUR),
    });
    const portfolio = PortfolioDeliverySchema.parse(await portfolioDelivery(options, 30));
    expect(portfolio.projects.map((entry) => entry.projectId)).toEqual([projectId]);
    expect(portfolio.projects[0]?.dora.tiers.deploymentFrequency).not.toBeNull();
    const theirsReport = await deliveryReport({ ...options, workspaceId: 'ws-2' }, theirs, 30);
    expect(theirsReport.counts.deployments).toBe(1);
    await expect(
      deliveryReport({ ...options, workspaceId: 'ws-2' }, projectId, 30),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
