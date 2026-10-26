import { asc, eq } from 'drizzle-orm';
import { projects } from '@automate/db';
import type { ReportArea, ReportCard, ReportFix, ReportInput } from '@automate/reporting';
import type { Scorecard } from '@automate/shared-contracts';
import { aiCodeReport, AI_CODE_GRADE_WINDOW_DAYS } from './ai-code-service.js';
import { deliveryReading } from './delivery-service.js';
import { projectEvals } from './eval-service.js';
import { branchFor, projectRow, type HealthStoreOptions } from './health-findings.js';
import {
  latestGrade,
  supplyChainScorecardFor,
  testEffectivenessCard,
  worstSuiteCard,
} from './scorecard-service.js';

/**
 * What the scheduled report says beyond the run window: one line each for DORA, AI-written
 * code and agent quality across the workspace's projects, and the inputs to its top three
 * actions — every project's grade fix-next and every failing scorecard's reasons.
 *
 * Read from the same services the dashboard reads, so the report and the scorecard pages
 * cannot disagree. Bounded to {@link REPORT_PROJECT_LIMIT} projects by name, and one project
 * whose read fails costs its own lines and nothing else: a report that never arrives because
 * one repository's delivery sync is broken would hide every other repository's news.
 */
export const REPORT_PROJECT_LIMIT = 20;

type Options = HealthStoreOptions & { now?: () => Date };

const cardOf = (project: string, card: Scorecard): ReportCard => ({
  project,
  status: card.status,
  score: card.score,
  reasons: card.reasons,
});

/** A read that may fail: its value, or `null`. */
async function settle<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

interface ProjectAreas {
  dora: ReportCard | null;
  aiCode: ReportCard | null;
  agents: ReportCard | null;
  others: ReportCard[];
  fixNext: ReportFix[];
}

async function projectAreas(options: Options, id: string, now: Date): Promise<ProjectAreas> {
  const project = await projectRow(options, id);
  const branch = branchFor(project);
  const [dora, ai, evals, supply, tests, grade] = await Promise.all([
    settle(() => deliveryReading(options, id)),
    settle(() => aiCodeReport(options, id, AI_CODE_GRADE_WINDOW_DAYS)),
    settle(() => projectEvals(options, id)),
    settle(() => supplyChainScorecardFor(options, id)),
    // The scheduler reads no run store, so flakes and causes are not in the digest's card.
    settle(() => testEffectivenessCard(options, project, branch, now, null)),
    settle(() => latestGrade(options, id, branch)),
  ]);
  const agents =
    evals === null ? null : worstSuiteCard(evals.suites.map((suite) => suite.scorecard));
  return {
    dora: dora === null ? null : cardOf(project.name, dora.dora),
    aiCode: ai === null ? null : cardOf(project.name, ai.scorecard),
    agents: agents === null ? null : cardOf(project.name, agents),
    others: [supply, tests].flatMap((card) => (card === null ? [] : [cardOf(project.name, card)])),
    fixNext: (grade?.grade.fixNext ?? []).map((fix) => ({
      project: project.name,
      title: fix.title,
      gain: fix.gain,
    })),
  };
}

const present = <T>(values: readonly (T | null)[]): T[] =>
  values.filter((value): value is T => value !== null);

/** The digest's area lines and action inputs for one workspace. */
export async function loadReportAreas(
  options: Options,
): Promise<Required<Pick<ReportInput, 'areas' | 'scorecards' | 'fixNext'>>> {
  const now = options.now?.() ?? new Date();
  const rows = await options.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.workspaceId, options.workspaceId))
    .orderBy(asc(projects.name))
    .limit(REPORT_PROJECT_LIMIT);
  const read: ProjectAreas[] = [];
  for (const { id } of rows) {
    const areas = await settle(() => projectAreas(options, id, now));
    if (areas !== null) read.push(areas);
  }
  const areas: ReportArea[] = [
    { label: 'DORA', cards: present(read.map((entry) => entry.dora)) },
    { label: 'AI code', cards: present(read.map((entry) => entry.aiCode)) },
    { label: 'Agent quality', cards: present(read.map((entry) => entry.agents)) },
  ];
  return {
    areas,
    scorecards: read.flatMap((entry) => entry.others),
    fixNext: read.flatMap((entry) => entry.fixNext),
  };
}
