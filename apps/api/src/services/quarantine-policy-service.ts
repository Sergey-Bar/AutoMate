/**
 * A project's quarantine policy, and its quarantine as a person reads it.
 *
 * The policy is the `quarantine` key of `projects.settings`, beside the `health` key the
 * repository-health settings use: one per-project settings document, scoped by workspace on
 * every read and write, rather than a table for one enum.
 */

import { and, eq } from 'drizzle-orm';
import { projects } from '@automate/db';
import { ownerOf, parseCodeowners } from '@automate/projects';
import { flakeCost } from '@automate/reporting';
import {
  DEFAULT_QUARANTINE_POLICY,
  QuarantinePolicySchema,
  storedTestIdentity,
  type ProjectQuarantine,
  type QuarantinePolicy,
} from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { flakeObservationsOf } from '../execution/insights.js';
import type { ExecutionRun } from '../execution/types.js';
import type { QuarantineEntry, QuarantineStore } from '../modules/dashboard/quarantine.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';
import {
  applyQuarantinePolicy,
  cleanStreak,
  type AutoQuarantineOutcome,
} from './auto-quarantine.js';

type Options = Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'>;

/** The history the policy and the cost read: thirty days, enough for a 20-pass streak. */
export const QUARANTINE_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

async function settingsOf(options: Options, projectId: string): Promise<Record<string, unknown>> {
  const rows = await options.db
    .select({ settings: projects.settings })
    .from(projects)
    .where(and(eq(projects.workspaceId, options.workspaceId), eq(projects.id, projectId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, 'No such project');
  return row.settings;
}

export async function readQuarantinePolicy(
  options: Options,
  projectId: string,
): Promise<QuarantinePolicy> {
  const parsed = QuarantinePolicySchema.safeParse(
    (await settingsOf(options, projectId))['quarantine'],
  );
  return parsed.success ? parsed.data : DEFAULT_QUARANTINE_POLICY;
}

export async function writeQuarantinePolicy(
  options: Options,
  projectId: string,
  policy: QuarantinePolicy,
): Promise<QuarantinePolicy> {
  const settings = await settingsOf(options, projectId);
  await options.db
    .update(projects)
    .set({ settings: { ...settings, quarantine: policy }, updatedAt: new Date() })
    .where(and(eq(projects.workspaceId, options.workspaceId), eq(projects.id, projectId)));
  return policy;
}

/** Whether an entry is about this project: it names it, or names none. */
function aboutProject(entry: QuarantineEntry, projectId: string): boolean {
  return entry.projectId === null || entry.projectId === projectId;
}

/**
 * The project's quarantine with an owner, a cost and a streak for each entry. The cost is
 * `flakeCost` over the window — the same numbers the insights page shows for the test.
 */
export async function projectQuarantine(
  deps: Options & {
    store: Pick<QuarantineStore, 'list'>;
    history: (since: Date) => Promise<readonly ExecutionRun[]>;
    now?: () => Date;
  },
  projectId: string,
): Promise<ProjectQuarantine> {
  const now = deps.now?.() ?? new Date();
  const settings = await settingsOf(deps, projectId);
  const parsedPolicy = QuarantinePolicySchema.safeParse(settings['quarantine']);
  const policy = parsedPolicy.success ? parsedPolicy.data : DEFAULT_QUARANTINE_POLICY;
  const health = settings['health'] as { codeowners?: unknown } | undefined;
  const rules = typeof health?.codeowners === 'string' ? parseCodeowners(health.codeowners) : [];
  const history = (
    await deps.history(new Date(now.getTime() - QUARANTINE_WINDOW_DAYS * DAY_MS))
  ).filter((run) => run.projectId === projectId);
  const costs = new Map(
    flakeCost(flakeObservationsOf(history)).map((cost) => [cost.testKey, cost]),
  );
  const entries = (await deps.store.list()).filter((entry) => aboutProject(entry, projectId));
  return {
    policy,
    windowDays: QUARANTINE_WINDOW_DAYS,
    entries: entries.map((entry) => {
      const identity =
        entry.stableId ?? storedTestIdentity({ file: entry.testFile, title: entry.testTitle });
      const cost = costs.get(identity);
      return {
        id: entry.id,
        testTitle: entry.testTitle,
        testFile: entry.testFile,
        stableId: entry.stableId,
        status: entry.status,
        quarantinedBy: entry.quarantinedBy,
        reason: entry.reason,
        quarantinedAt: entry.quarantinedAt,
        releasedAt: entry.releasedAt,
        owner: ownerOf(rules, entry.testFile === '' ? null : entry.testFile),
        daysQuarantined: Math.max(
          0,
          Math.floor((now.getTime() - Date.parse(entry.quarantinedAt)) / DAY_MS),
        ),
        retriesSpent: cost?.retriesSpent ?? 0,
        wastedMs: cost?.wastedMs ?? 0,
        blockedRuns: cost?.blockedRuns ?? 0,
        cleanStreak: cleanStreak(history, identity),
      };
    }),
  };
}

/** The post-ingest hook: the project's policy, over its window, against the quarantine. */
export async function applyProjectQuarantinePolicy(
  deps: Options & {
    store: Pick<QuarantineStore, 'list' | 'add' | 'resolve'>;
    history: (since: Date) => Promise<readonly ExecutionRun[]>;
    now?: () => Date;
  },
  projectId: string,
): Promise<AutoQuarantineOutcome> {
  const policy = await readQuarantinePolicy(deps, projectId);
  if (policy.mode !== 'auto') return { quarantined: [], released: [] };
  const now = deps.now?.() ?? new Date();
  const history = await deps.history(new Date(now.getTime() - QUARANTINE_WINDOW_DAYS * DAY_MS));
  return applyQuarantinePolicy({ policy, projectId, history, store: deps.store });
}
