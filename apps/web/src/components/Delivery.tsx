import React from 'react';
import {
  Badge,
  Button,
  Input,
  Select,
  StatusDot,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@automate/ui';
import type {
  DeliveryReport,
  DeliverySource,
  DeliverySourceBody,
  MetricUnit,
} from '@automate/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import type { DeliveryClient } from '../lib/delivery-client.js';
import type { HealthClient } from '../lib/health-client.js';
import { ago } from '../lib/health-view.js';
import type { QaClient } from '../lib/qa-client.js';
import { canOperate, failureText } from '../lib/roles.js';
import { formatMetricValue } from '../lib/scorecard-view.js';
import { PageFrame, PageHeader, Panel, Quiet, Segmented } from './kit.js';
import { Loaded, ProjectPage, type ProjectContext } from './ProjectPage.js';
import { ScorecardCard } from './ScorecardCard.js';
import { StatusLine } from './StatusLine.js';
import { useToast } from './Toasts.js';

/**
 * Delivery: how fast and how safely the repository ships, from GitHub and the push door.
 *
 * The DORA and flow scorecards lead, each with its verdict and limiter; beneath them the
 * figures they were computed from — the tier of each DORA metric against the published 2024
 * bands, the cycle-time stages, the size mix and the pull requests that went quiet. No person
 * appears anywhere: the API sends repository-level aggregates and pull-request numbers.
 */
export const DELIVERY_WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const;
type WindowValue = (typeof DELIVERY_WINDOWS)[number]['value'];

export function DeliveryPage({
  qa,
  health,
  delivery,
  projectId,
}: {
  qa: QaClient;
  health: HealthClient;
  delivery: DeliveryClient;
  projectId?: string | undefined;
}): React.ReactElement {
  return (
    <ProjectPage qa={qa} health={health} title="Delivery" projectId={projectId}>
      {(context) => <DeliveryBody context={context} delivery={delivery} />}
    </ProjectPage>
  );
}

function DeliveryBody({
  context,
  delivery,
}: {
  context: ProjectContext;
  delivery: DeliveryClient;
}): React.ReactElement {
  const { project, switcher, who } = context;
  const [days, setDays] = React.useState<WindowValue>('30');
  const [version, setVersion] = React.useState(0);
  const reload = React.useCallback(() => setVersion((value) => value + 1), []);
  const report = useResource<DeliveryReport>(
    () => delivery.getReport(project.id, Number(days)),
    [delivery, project.id, days, version],
  );
  const operator = canOperate(who);
  return (
    <PageFrame data-testid="delivery-page" className="h-auto gap-4 sm:gap-6">
      <PageHeader
        title="Delivery"
        subtitle={`How ${project.name} ships, over the last ${days} days`}
        actions={
          <>
            {switcher}
            <Segmented label="Window" options={DELIVERY_WINDOWS} value={days} onChange={setDays} />
            {operator ? (
              <SyncButton delivery={delivery} projectId={project.id} onQueued={reload} />
            ) : null}
          </>
        }
      />
      <Loaded resource={report} label="delivery" testId="delivery">
        {(value) => <DeliveryReportView report={value} />}
      </Loaded>
      <SourcePanel delivery={delivery} projectId={project.id} operator={operator} />
    </PageFrame>
  );
}

function failingCount(report: DeliveryReport): number {
  return [report.dora, report.flow].filter((card) => card.status === 'fail').length;
}

function DeliveryReportView({ report }: { report: DeliveryReport }): React.ReactElement {
  const failing = failingCount(report);
  return (
    <>
      <StatusLine
        data-testid="delivery-status"
        value={String(failing)}
        tone={failing === 0 ? 'good' : 'bad'}
        sentence={
          failing === 1
            ? 'of the two delivery scorecards fails. Its reasons say what to change.'
            : 'of the two delivery scorecards fail.'
        }
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <ScorecardCard scorecard={report.dora} />
        <ScorecardCard scorecard={report.flow} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <DoraTiers report={report} />
        <CycleTime report={report} />
        <SizeMix report={report} />
        <StalePullRequests report={report} />
      </div>
      <SyncStatus report={report} />
    </>
  );
}

type DoraKey = keyof DeliveryReport['doraResult']['metrics'];

/**
 * The unit each DORA metric is computed in, as `computeDora` documents it. The tiers are the
 * published 2024 performance clusters; rework rate has none.
 */
const DORA_ROWS: ReadonlyArray<{ key: DoraKey; label: string; unit: MetricUnit }> = [
  { key: 'deploymentFrequency', label: 'Deployment frequency', unit: 'per-week' },
  { key: 'changeLeadTime', label: 'Change lead time', unit: 'hours' },
  { key: 'changeFailureRate', label: 'Change failure rate', unit: 'ratio' },
  { key: 'recoveryTime', label: 'Failed deployment recovery time', unit: 'hours' },
  { key: 'reworkRate', label: 'Deployment rework rate', unit: 'ratio' },
];

const TIER_VARIANT = {
  elite: 'success',
  high: 'success',
  medium: 'warning',
  low: 'danger',
} as const;

function DoraTiers({ report }: { report: DeliveryReport }): React.ReactElement {
  const { metrics, minSample } = report.doraResult;
  return (
    <Panel title="DORA tiers" data-testid="dora-tiers">
      <Table aria-label="DORA metrics and tiers">
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Tier</TableHead>
            <TableHead className="hidden sm:table-cell">Sample</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {DORA_ROWS.map((row) => {
            const metric = metrics[row.key];
            return (
              <TableRow key={row.key} data-testid={`dora-${row.key}`}>
                <TableCell>{row.label}</TableCell>
                <TableCell numeric>
                  {metric.value === null
                    ? `too little data (needs ${String(minSample)})`
                    : formatMetricValue(metric.value, row.unit)}
                </TableCell>
                <TableCell>
                  {metric.band === null ? (
                    <span className="text-xs text-fg-muted">no tier</span>
                  ) : (
                    <Badge variant={TIER_VARIANT[metric.band]}>{metric.band}</Badge>
                  )}
                </TableCell>
                <TableCell numeric className="hidden sm:table-cell">
                  {metric.sampleSize}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="mt-2 max-w-measure text-xs text-fg-muted" data-testid="dora-source">
        Tiers are the performance clusters of the{' '}
        <a
          href="https://dora.dev/research/2024/dora-report/"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          Accelerate State of DevOps Report 2024
        </a>{' '}
        (DORA 2024 bands). Rework rate has no published tier.
      </p>
    </Panel>
  );
}

const STAGES = [
  { key: 'coding', label: 'Coding' },
  { key: 'pickup', label: 'Pickup' },
  { key: 'review', label: 'Review' },
  { key: 'deploy', label: 'Deploy' },
] as const;

function hours(value: number | null): string {
  return value === null ? '—' : formatMetricValue(value, 'hours');
}

function CycleTime({ report }: { report: DeliveryReport }): React.ReactElement {
  const { cycleTime, merged } = report.flowResult;
  return (
    <Panel title="Cycle time" data-testid="cycle-time">
      <Table aria-label="Cycle time by stage">
        <TableHeader>
          <TableRow>
            <TableHead>Stage</TableHead>
            <TableHead>Median</TableHead>
            <TableHead>p75</TableHead>
            <TableHead>Pull requests</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {STAGES.map((stage) => (
            <TableRow key={stage.key} data-testid={`stage-${stage.key}`}>
              <TableCell>{stage.label}</TableCell>
              <TableCell numeric>{hours(cycleTime[stage.key].medianHours)}</TableCell>
              <TableCell numeric>{hours(cycleTime[stage.key].p75Hours)}</TableCell>
              <TableCell numeric>{cycleTime[stage.key].sampleSize}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-2 max-w-measure text-xs text-fg-muted">
        {`${String(merged)} merged in the window. A stage with no sample has no median.`}
      </p>
    </Panel>
  );
}

const SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;

function SizeMix({ report }: { report: DeliveryReport }): React.ReactElement {
  const { sizes } = report.flowResult;
  const total = SIZES.reduce((sum, size) => sum + sizes[size], 0);
  return (
    <Panel title="Pull request size" data-testid="size-mix">
      {total === 0 ? (
        <Quiet>No pull request merged in this window.</Quiet>
      ) : (
        <Table aria-label="Pull requests by size">
          <TableHeader>
            <TableRow>
              <TableHead>Size</TableHead>
              <TableHead>Pull requests</TableHead>
              <TableHead>
                <span className="sr-only">Share</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SIZES.map((size) => (
              <TableRow key={size} data-testid={`size-${size}`}>
                <TableCell>{size}</TableCell>
                <TableCell numeric>{sizes[size]}</TableCell>
                <TableCell className="w-1/2">
                  <span
                    aria-hidden="true"
                    className="block h-1.5 overflow-hidden rounded-full bg-surface-muted"
                  >
                    <span
                      className="block h-full rounded-full bg-chart-1"
                      style={{ width: `${String(Math.round((sizes[size] / total) * 100))}%` }}
                    />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

function StalePullRequests({ report }: { report: DeliveryReport }): React.ReactElement {
  const stale = report.stalePullRequests;
  return (
    <Panel title="Stale pull requests" data-testid="stale-prs">
      {stale.length === 0 ? (
        <Quiet>{`No open pull request has been idle more than ${String(report.flowResult.staleAfterDays)} days.`}</Quiet>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {stale.map((pr) => (
            <li key={pr.number} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0 truncate" title={pr.title}>
                <span className="font-mono text-xs text-fg-muted">{`#${String(pr.number)} `}</span>
                {pr.title}
              </span>
              <span className="shrink-0 tabular-nums text-xs text-warning">
                {`${String(pr.daysIdle)} days idle`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const SYNC_DOT = {
  ok: 'good',
  failed: 'bad',
  rate_limited: 'warn',
  not_configured: 'unknown',
} as const;

function syncSentence(sync: DeliveryReport['sync']): string {
  if (!sync.configured) return 'No delivery source is configured: nothing is read from GitHub.';
  if (!sync.enabled) return 'The delivery source is saved but turned off.';
  if (sync.rateLimitedUntil !== null) {
    return `GitHub is rate limiting the sync until ${sync.rateLimitedUntil}.`;
  }
  return `Last synced ${ago(sync.lastSyncedAt)}.`;
}

function SyncStatus({ report }: { report: DeliveryReport }): React.ReactElement {
  const { sync, counts } = report;
  const status = sync.lastStatus ?? 'not_configured';
  return (
    <Panel title="Sync" data-testid="sync-status">
      <p className="flex max-w-measure items-center gap-2 text-sm">
        <StatusDot status={SYNC_DOT[status]} label={status.replace('_', ' ')} />
        {syncSentence(sync)}
      </p>
      {sync.lastError === null ? null : (
        <p role="alert" className="mt-1 max-w-measure text-xs text-danger">
          {sync.lastError}
        </p>
      )}
      <p className="mt-2 max-w-measure text-xs tabular-nums text-fg-muted">
        {`Computed over ${String(counts.deployments)} deployments, ${String(counts.pullRequests)} pull requests and ${String(counts.incidents)} incidents, in ${report.productionEnvironments.join(', ')}.`}
        {sync.latest === null
          ? ''
          : ` Latest sync: ${sync.latest.status}, requested by ${sync.latest.requestedBy}.`}
      </p>
    </Panel>
  );
}

function SyncButton({
  delivery,
  projectId,
  onQueued,
}: {
  delivery: DeliveryClient;
  projectId: string;
  onQueued: () => void;
}): React.ReactElement {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const sync = () => {
    setBusy(true);
    delivery
      .sync(projectId)
      .then((queued) => {
        toast({
          tone: 'success',
          title: queued.duplicate ? 'A sync was already queued' : 'Sync queued',
          description: 'The figures refresh when it finishes.',
        });
        onQueued();
      })
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: 'Sync not queued',
          description: failureText(error, 'The sync could not start'),
        }),
      )
      .finally(() => setBusy(false));
  };
  return (
    <Button data-testid="delivery-sync" onClick={sync} disabled={busy} className="min-h-11">
      {busy ? 'Queuing…' : 'Sync now'}
    </Button>
  );
}

/** The comma-separated field as a list, empty entries dropped. */
export function listField(text: string): string[] {
  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function SourcePanel({
  delivery,
  projectId,
  operator,
}: {
  delivery: DeliveryClient;
  projectId: string;
  operator: boolean;
}): React.ReactElement {
  const [version, setVersion] = React.useState(0);
  const source = useResource<DeliverySource>(
    () => delivery.getSource(projectId),
    [delivery, projectId, version],
  );
  return (
    <Panel title="Delivery source" data-testid="delivery-source">
      <Loaded resource={source} label="the delivery source">
        {(value) =>
          operator ? (
            <SourceForm
              delivery={delivery}
              projectId={projectId}
              source={value}
              onSaved={() => setVersion((current) => current + 1)}
            />
          ) : (
            <SourceSummary source={value} />
          )
        }
      </Loaded>
    </Panel>
  );
}

function SourceSummary({ source }: { source: DeliverySource }): React.ReactElement {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      <dt className="text-fg-muted">Repository</dt>
      <dd>
        {source.repository === null
          ? 'Not a GitHub repository'
          : `${source.repository.owner}/${source.repository.repo}`}
      </dd>
      <dt className="text-fg-muted">State</dt>
      <dd>
        {source.configured ? (source.enabled ? `On, ${source.cadence}` : 'Off') : 'Not configured'}
      </dd>
      <dt className="text-fg-muted">Production</dt>
      <dd>{source.productionEnvironments.join(', ')}</dd>
      <dt className="text-fg-muted">Deploy workflows</dt>
      <dd>{source.deployWorkflows.length === 0 ? 'None' : source.deployWorkflows.join(', ')}</dd>
      <dt className="text-fg-muted">Next sync</dt>
      <dd>{source.nextSyncAt ?? 'None scheduled'}</dd>
    </dl>
  );
}

function SourceForm({
  delivery,
  projectId,
  source,
  onSaved,
}: {
  delivery: DeliveryClient;
  projectId: string;
  source: DeliverySource;
  onSaved: () => void;
}): React.ReactElement {
  const toast = useToast();
  const ids = React.useId();
  const [enabled, setEnabled] = React.useState(source.enabled);
  const [cadence, setCadence] = React.useState(source.cadence);
  const [environments, setEnvironments] = React.useState(source.productionEnvironments.join(', '));
  const [workflows, setWorkflows] = React.useState(source.deployWorkflows.join(', '));
  const [error, setError] = React.useState<string | null>(null);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const production = listField(environments);
    if (production.length === 0) {
      setError('Name at least one production environment.');
      return;
    }
    setError(null);
    const body: DeliverySourceBody = {
      enabled,
      cadence,
      productionEnvironments: production,
      deployWorkflows: listField(workflows),
    };
    delivery
      .setSource(projectId, body)
      .then(() => {
        toast({ tone: 'success', title: 'Delivery source saved' });
        onSaved();
      })
      .catch((failure: unknown) => setError(failureText(failure, 'The source was not saved')));
  };
  return (
    <form onSubmit={submit} aria-label="Delivery source" className="space-y-3">
      <SourceSummary source={source} />
      <div className="grid gap-2 sm:grid-cols-4 sm:items-end">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-5 w-5 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          />
          Read from GitHub
        </label>
        <Select
          id={`${ids}-cadence`}
          label="Cadence"
          value={cadence}
          onChange={(event) => setCadence(event.target.value as DeliverySource['cadence'])}
          options={[
            { value: 'hourly', label: 'Hourly' },
            { value: 'daily', label: 'Daily' },
          ]}
        />
        <Input
          id={`${ids}-environments`}
          label="Production environments"
          value={environments}
          onChange={(event) => setEnvironments(event.target.value)}
        />
        <Input
          id={`${ids}-workflows`}
          label="Deploy workflows"
          value={workflows}
          placeholder="Deploy, Release"
          onChange={(event) => setWorkflows(event.target.value)}
        />
      </div>
      {error === null ? null : (
        <p role="alert" className="max-w-measure text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" variant="secondary" className="min-h-11">
        Save source
      </Button>
    </form>
  );
}
