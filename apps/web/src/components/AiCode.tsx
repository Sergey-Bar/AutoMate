import React from 'react';
import {
  Badge,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@automate/ui';
import {
  AI_ATTRIBUTIONS,
  type AiAttribution,
  type AiCodePullRequestList,
  type AiCodeReport,
  type AiOutcomeComparisonRecord,
} from '@automate/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import type { AiCodeClient } from '../lib/ai-code-client.js';
import type { HealthClient } from '../lib/health-client.js';
import { shortDate } from '../lib/insights.js';
import type { QaClient } from '../lib/qa-client.js';
import { PageFrame, PageHeader, Panel, Quiet, Segmented } from './kit.js';
import { Loaded, PageControls, ProjectPage, type ProjectContext } from './ProjectPage.js';
import { ScorecardCard } from './ScorecardCard.js';
import { StatusLine } from './StatusLine.js';

/**
 * AI-written code: how much change an AI wrote, and what happened to it afterwards.
 *
 * ## Kinds of authorship, never people
 *
 * The API sends attributions, tools and pull-request numbers, and nothing that names a
 * person; this screen adds none. A per-person AI-usage table is a surveillance instrument
 * and the governance question does not need one.
 *
 * ## An interval, or the word "insufficient"
 *
 * Every rate is drawn with its interval, and a group with fewer observations than the
 * comparison's `minSample` says so rather than showing a rate nobody should act on.
 */
const WINDOWS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
] as const;
type WindowValue = (typeof WINDOWS)[number]['value'];

export const ATTRIBUTION_LABEL: Readonly<Record<AiAttribution, string>> = {
  'agent-authored': 'Agent-authored',
  'ai-assisted': 'AI-assisted',
  human: 'Human',
  unknown: 'Unknown',
};

const ATTRIBUTION_FILL: Readonly<Record<AiAttribution, string>> = {
  'agent-authored': 'bg-chart-1',
  'ai-assisted': 'bg-chart-2',
  human: 'bg-chart-3',
  unknown: 'bg-chart-skipped',
};

export function AiCodePage({
  qa,
  health,
  aiCode,
  projectId,
}: {
  qa: QaClient;
  health: HealthClient;
  aiCode: AiCodeClient;
  projectId?: string | undefined;
}): React.ReactElement {
  return (
    <ProjectPage qa={qa} health={health} title="AI code" projectId={projectId}>
      {(context) => <AiCodeBody context={context} aiCode={aiCode} />}
    </ProjectPage>
  );
}

function AiCodeBody({
  context,
  aiCode,
}: {
  context: ProjectContext;
  aiCode: AiCodeClient;
}): React.ReactElement {
  const { project, switcher } = context;
  const [days, setDays] = React.useState<WindowValue>('90');
  const report = useResource<AiCodeReport>(
    () => aiCode.getReport(project.id, Number(days)),
    [aiCode, project.id, days],
  );
  return (
    <PageFrame data-testid="ai-code-page" className="h-auto gap-4 sm:gap-6">
      <PageHeader
        title="AI code"
        subtitle={`What AI wrote in ${project.name}, and what happened to it`}
        actions={
          <>
            {switcher}
            <Segmented label="Window" options={WINDOWS} value={days} onChange={setDays} />
          </>
        }
      />
      <Loaded resource={report} label="AI-written code" testId="ai-code">
        {(value) => <AiCodeReportView report={value} />}
      </Loaded>
      <PullRequests aiCode={aiCode} projectId={project.id} />
    </PageFrame>
  );
}

const RATE_KEYS = [
  'revert',
  'changeFailure',
  'followUpFix14',
  'followUpFix30',
  'rubberStamp',
] as const;
type RateKey = (typeof RATE_KEYS)[number];

/** Outcome rates on which an AI group did worse than human change. Every rate is lower-better. */
export function worseThanHuman(comparison: AiOutcomeComparisonRecord): number {
  const groups = [comparison.groups['agent-authored'], comparison.groups['ai-assisted']];
  return groups.reduce(
    (sum, group) =>
      sum +
      (group.vsHuman === null
        ? 0
        : RATE_KEYS.filter((key) => group.vsHuman?.[key] === 'higher').length),
    0,
  );
}

function AiCodeReportView({ report }: { report: AiCodeReport }): React.ReactElement {
  const worse = worseThanHuman(report.comparison);
  return (
    <>
      <StatusLine
        data-testid="ai-code-status"
        value={String(worse)}
        tone={worse === 0 ? 'good' : 'bad'}
        sentence={
          worse === 1
            ? 'outcome rate is worse for AI-written change than for human change.'
            : 'outcome rates are worse for AI-written change than for human change.'
        }
      />
      {report.staleAttribution === 0 ? null : (
        <p className="max-w-measure text-sm text-warning" data-testid="stale-attribution">
          {`${String(report.staleAttribution)} merged pull requests were classified against an older signature table; the next delivery sync re-classifies them.`}
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <ScorecardCard scorecard={report.scorecard} />
        <WeeklyShare report={report} />
      </div>
      <Outcomes comparison={report.comparison} />
      <Agents comparison={report.comparison} />
    </>
  );
}

const WEEK_KEYS: ReadonlyArray<{
  key: 'agentAuthored' | 'aiAssisted' | 'human' | 'unknown';
  attribution: AiAttribution;
}> = [
  { key: 'agentAuthored', attribution: 'agent-authored' },
  { key: 'aiAssisted', attribution: 'ai-assisted' },
  { key: 'human', attribution: 'human' },
  { key: 'unknown', attribution: 'unknown' },
];

type Week = AiCodeReport['share'][number];

function weekSentence(week: Week): string {
  if (week.total === 0) return `Week of ${shortDate(week.weekStart)}: nothing merged`;
  const parts = WEEK_KEYS.map(
    ({ key, attribution }) =>
      `${String(week[key])} ${ATTRIBUTION_LABEL[attribution].toLowerCase()}`,
  );
  return `Week of ${shortDate(week.weekStart)}: ${parts.join(', ')}`;
}

function WeeklyShare({ report }: { report: AiCodeReport }): React.ReactElement {
  const [view, setView] = React.useState<'chart' | 'table'>('chart');
  return (
    <Panel
      title="Merged change by week"
      data-testid="weekly-share"
      action={
        <Segmented
          label="Show as"
          options={[
            { value: 'chart', label: 'Chart' },
            { value: 'table', label: 'Table' },
          ]}
          value={view}
          onChange={setView}
        />
      }
    >
      {report.share.length === 0 ? (
        <Quiet>No pull request merged in this window.</Quiet>
      ) : view === 'chart' ? (
        <ShareChart weeks={report.share} />
      ) : (
        <ShareTable weeks={report.share} />
      )}
    </Panel>
  );
}

function ShareChart({ weeks }: { weeks: readonly Week[] }): React.ReactElement {
  return (
    <>
      <ul className="space-y-1.5" aria-label="Share by week">
        {weeks.map((week) => (
          <li key={week.weekStart} className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0 tabular-nums text-fg-muted">
              {shortDate(week.weekStart)}
            </span>
            <span
              role="img"
              aria-label={weekSentence(week)}
              data-testid={`week-${week.weekStart}`}
              className="flex h-3 flex-1 overflow-hidden rounded-full bg-surface-muted"
            >
              {WEEK_KEYS.map(({ key, attribution }) =>
                week.total === 0 || week[key] === 0 ? null : (
                  <span
                    key={key}
                    className={ATTRIBUTION_FILL[attribution]}
                    style={{ width: `${String((week[key] / week.total) * 100)}%` }}
                  />
                ),
              )}
            </span>
            <span className="w-8 shrink-0 text-right tabular-nums">{week.total}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" aria-label="Legend">
        {WEEK_KEYS.map(({ attribution }) => (
          <li key={attribution} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 rounded-full', ATTRIBUTION_FILL[attribution])}
            />
            {ATTRIBUTION_LABEL[attribution]}
          </li>
        ))}
      </ul>
    </>
  );
}

function ShareTable({ weeks }: { weeks: readonly Week[] }): React.ReactElement {
  return (
    <Table aria-label="Merged pull requests by week and attribution">
      <TableHeader>
        <TableRow>
          <TableHead>Week of</TableHead>
          {WEEK_KEYS.map(({ attribution }) => (
            <TableHead key={attribution}>{ATTRIBUTION_LABEL[attribution]}</TableHead>
          ))}
          <TableHead>Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {weeks.map((week) => (
          <TableRow key={week.weekStart} data-testid={`week-row-${week.weekStart}`}>
            <TableCell>{shortDate(week.weekStart)}</TableCell>
            {WEEK_KEYS.map(({ key }) => (
              <TableCell key={key} numeric>
                {week[key]}
              </TableCell>
            ))}
            <TableCell numeric>{week.total}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type Group = AiOutcomeComparisonRecord['groups']['human'];
type RateStat = Group['revert'];
type ValueStat = Group['reviewDepth'];

const RATE_LABEL: Readonly<Record<RateKey, string>> = {
  revert: 'Reverted',
  changeFailure: 'Caused a failed deployment',
  followUpFix14: 'Needed a fix within 14 days',
  followUpFix30: 'Needed a fix within 30 days',
  rubberStamp: 'Approved without a real review',
};

const VALUE_ROWS = [
  {
    key: 'reviewDepth',
    label: 'Review comments per change',
    format: (value: number) => value.toFixed(1),
  },
  {
    key: 'diffCoverage',
    label: 'Diff coverage',
    format: (value: number) => `${value.toFixed(1)}%`,
  },
  {
    key: 'newHighFindings',
    label: 'New high or critical findings',
    format: (value: number) => value.toFixed(1),
  },
] as const;

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** A rate with its interval, or why there is none. */
export function rateText(stat: RateStat, minSample: number): string {
  if (stat.rate === null || stat.trials < minSample) {
    return `insufficient (n = ${String(stat.trials)})`;
  }
  const interval =
    stat.interval === null ? '' : ` (${percent(stat.interval.low)}–${percent(stat.interval.high)})`;
  return `${percent(stat.rate)}${interval}`;
}

function valueText(stat: ValueStat, minSample: number, format: (value: number) => string): string {
  if (stat.value === null || stat.sampleSize < minSample) {
    return `insufficient (n = ${String(stat.sampleSize)})`;
  }
  return format(stat.value);
}

const COMPARISON_WORD = {
  higher: 'higher than human',
  lower: 'lower than human',
  same: 'no different from human',
  insufficient: 'too little data to compare',
} as const;

function Outcomes({ comparison }: { comparison: AiOutcomeComparisonRecord }): React.ReactElement {
  const { minSample, groups } = comparison;
  return (
    <Panel title="Outcomes by attribution" data-testid="outcomes">
      <Table aria-label="Outcome rates by attribution">
        <TableHeader>
          <TableRow>
            <TableHead>Outcome</TableHead>
            {AI_ATTRIBUTIONS.map((attribution) => (
              <TableHead key={attribution}>
                {`${ATTRIBUTION_LABEL[attribution]} (n = ${String(groups[attribution].n)})`}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {RATE_KEYS.map((key) => (
            <TableRow key={key} data-testid={`outcome-${key}`}>
              <TableCell>{RATE_LABEL[key]}</TableCell>
              {AI_ATTRIBUTIONS.map((attribution) => (
                <TableCell key={attribution} numeric>
                  {rateText(groups[attribution][key], minSample)}
                  <VersusHuman group={groups[attribution]} rate={key} />
                </TableCell>
              ))}
            </TableRow>
          ))}
          {VALUE_ROWS.map((row) => (
            <TableRow key={row.key} data-testid={`outcome-${row.key}`}>
              <TableCell>{row.label}</TableCell>
              {AI_ATTRIBUTIONS.map((attribution) => (
                <TableCell key={attribution} numeric>
                  {valueText(groups[attribution][row.key], minSample, row.format)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-2 max-w-measure text-xs text-fg-muted">
        {`Rates carry a 95% interval. A group with fewer than ${String(minSample)} changes is insufficient. ${String(comparison.excluded)} of ${String(comparison.total)} changes were excluded.`}
      </p>
    </Panel>
  );
}

function VersusHuman({ group, rate }: { group: Group; rate: RateKey }): React.ReactElement | null {
  const verdict = group.vsHuman?.[rate];
  if (verdict === undefined) return null;
  return (
    <span className={`block text-xs ${verdict === 'higher' ? 'text-danger' : 'text-fg-muted'}`}>
      {COMPARISON_WORD[verdict]}
    </span>
  );
}

function Agents({ comparison }: { comparison: AiOutcomeComparisonRecord }): React.ReactElement {
  return (
    <Panel title="By agent" data-testid="ai-agents">
      {comparison.agents.length === 0 ? (
        <Quiet>No change in this window was attributed to a named agent.</Quiet>
      ) : (
        <Table aria-label="Outcomes by agent">
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Changes</TableHead>
              <TableHead>Reverted</TableHead>
              <TableHead>Failed deployment</TableHead>
              <TableHead className="hidden md:table-cell">Fix within 14 days</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison.agents.map((agent) => (
              <TableRow key={agent.agent} data-testid={`agent-${agent.agent}`}>
                <TableCell className="font-mono text-xs">{agent.agent}</TableCell>
                <TableCell numeric>{agent.n}</TableCell>
                <TableCell numeric>{rateText(agent.revert, comparison.minSample)}</TableCell>
                <TableCell numeric>{rateText(agent.changeFailure, comparison.minSample)}</TableCell>
                <TableCell numeric className="hidden md:table-cell">
                  {rateText(agent.followUpFix14, comparison.minSample)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

const PR_PAGE = 25;

const ATTRIBUTION_VARIANT = {
  'agent-authored': 'default',
  'ai-assisted': 'secondary',
  human: 'outline',
  unknown: 'outline',
} as const;

function PullRequests({
  aiCode,
  projectId,
}: {
  aiCode: AiCodeClient;
  projectId: string;
}): React.ReactElement {
  const [attribution, setAttribution] = React.useState<AiAttribution | ''>('');
  const [offset, setOffset] = React.useState(0);
  const id = React.useId();
  const list = useResource<AiCodePullRequestList>(
    () =>
      aiCode.getPullRequests(projectId, {
        attribution: attribution === '' ? undefined : attribution,
        offset,
        limit: PR_PAGE,
      }),
    [aiCode, projectId, attribution, offset],
  );
  return (
    <Panel title="Pull requests" data-testid="ai-prs">
      <div className="mb-3 max-w-xs">
        <Select
          id={`${id}-attribution`}
          label="Attribution"
          value={attribution}
          onChange={(event) => {
            setAttribution(event.target.value as AiAttribution | '');
            setOffset(0);
          }}
          options={[
            { value: '', label: 'Every attribution' },
            ...AI_ATTRIBUTIONS.map((entry) => ({ value: entry, label: ATTRIBUTION_LABEL[entry] })),
          ]}
        />
      </div>
      <Loaded resource={list} label="the pull requests" testId="ai-prs">
        {(value) => <PullRequestTable list={value} offset={offset} onOffset={setOffset} />}
      </Loaded>
    </Panel>
  );
}

function PullRequestTable({
  list,
  offset,
  onOffset,
}: {
  list: AiCodePullRequestList;
  offset: number;
  onOffset: (offset: number) => void;
}): React.ReactElement {
  if (list.total === 0) return <Quiet data-testid="ai-prs-empty">No pull request matches.</Quiet>;
  return (
    <>
      <Table aria-label="Pull requests and their attribution">
        <TableHeader>
          <TableRow>
            <TableHead>Pull request</TableHead>
            <TableHead>Attribution</TableHead>
            <TableHead className="hidden md:table-cell">Confidence</TableHead>
            <TableHead className="hidden lg:table-cell">Signals</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.items.map((pr) => (
            <TableRow key={pr.number} data-testid={`pr-${String(pr.number)}`}>
              <TableCell>
                <span className="font-mono text-xs text-fg-muted">{`#${String(pr.number)} `}</span>
                <span className="text-sm">{pr.title}</span>
                <span className="block text-xs text-fg-muted">{pr.state}</span>
              </TableCell>
              <TableCell>
                <Badge variant={ATTRIBUTION_VARIANT[pr.attribution]}>
                  {ATTRIBUTION_LABEL[pr.attribution]}
                </Badge>
                {pr.agent === null ? null : (
                  <span className="ml-2 font-mono text-xs">{pr.agent}</span>
                )}
              </TableCell>
              <TableCell numeric className="hidden md:table-cell">
                {percent(pr.confidence)}
              </TableCell>
              <TableCell className="hidden text-xs lg:table-cell">
                {pr.signals.length === 0
                  ? 'No signal'
                  : pr.signals.map((signal) => `${signal.kind}: ${signal.detail}`).join(' · ')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <PageControls
        offset={offset}
        shown={list.items.length}
        total={list.total}
        size={PR_PAGE}
        onOffset={onOffset}
        testId="ai-prs-range"
      />
    </>
  );
}
