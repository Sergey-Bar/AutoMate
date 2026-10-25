import React from 'react';
import {
  Badge,
  Button,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  EmptyState,
  Input,
  Meter,
  Select,
  Skeleton,
  Sparkline,
  StatusDot,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  cn,
} from '@automate/ui';
import {
  FINDING_SEVERITIES,
  HEALTH_DIMENSIONS,
  type FindingSeverity,
  type FindingState,
  type HealthDimension,
  type HealthFinding,
  type HealthHistory,
  type ProjectHealth,
} from '@automate/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import type { HealthClient, HealthSettings } from '../lib/health-client.js';
import {
  SEVERITY_VARIANT,
  ago,
  dimensionLabel,
  letterTone,
  meterVariant,
  notMeasured,
  whatIsGood,
} from '../lib/health-view.js';
import { PageFrame, PageHeader, Panel, Quiet, Segmented } from './kit.js';

/**
 * One repository's health: the grade first, then why, then what to do.
 *
 * ## One answer, then detail on demand
 *
 * The screen leads with a single letter and the sentence that explains it — the limiter is
 * on the same line as the number, never a click away, because a geometric grade without its
 * limiter cannot be diagnosed. The seven dimensions, the fix-next list and the findings sit
 * beneath it in that order: what, why, what next, the evidence.
 */
export function RepoHealth({
  health: client,
  projectId,
}: {
  health: HealthClient;
  projectId: string;
}): React.ReactElement {
  const [version, setVersion] = React.useState(0);
  const reload = React.useCallback(() => setVersion((value) => value + 1), []);
  // After a scan starts, its reports land one scanner at a time: re-read every ten seconds
  // for two minutes rather than asking the reader to refresh.
  const [polls, setPolls] = React.useState(0);
  React.useEffect(() => {
    if (polls === 0) return undefined;
    const timer = setTimeout(() => {
      reload();
      setPolls((value) => value - 1);
    }, 10_000);
    return () => clearTimeout(timer);
  }, [polls, reload]);
  const scanStarted = React.useCallback(() => setPolls(12), []);
  const health = useResource<ProjectHealth>(
    () => client.getHealth(projectId),
    [client, projectId, version],
  );
  const history = useResource<HealthHistory>(
    () => client.getHistory(projectId, 90),
    [client, projectId, version],
  );
  const title = health.status === 'ready' ? health.value.name : 'Repository health';

  if (health.status === 'loading') {
    return (
      <PageFrame data-testid="repo-health-loading">
        <PageHeader title={title} />
        <Skeleton className="h-40 w-full" />
      </PageFrame>
    );
  }
  if (health.status === 'error') {
    return (
      <PageFrame>
        <PageHeader title={title} />
        <EmptyState
          headingLevel={2}
          title="Could not read this repository's health"
          description={health.message}
        />
      </PageFrame>
    );
  }
  return (
    <PageFrame data-testid="repo-health" className="h-auto gap-4 sm:gap-6">
      <PageHeader
        title={title}
        subtitle={
          <span data-testid="repo-health-subject">
            {health.value.branch} ·{' '}
            {health.value.reports.length === 0
              ? 'no reports yet'
              : `latest report ${ago(health.value.reports[0]?.receivedAt ?? null)}`}
          </span>
        }
        actions={<ScanButton client={client} projectId={projectId} onStarted={scanStarted} />}
      />
      <GradeHero value={health.value} trend={history.status === 'ready' ? history.value : null} />
      <DimensionStrip value={health.value} />
      <div className="grid gap-3 lg:grid-cols-2">
        <FixNext value={health.value} />
        <WhatIsGood value={health.value} />
      </div>
      <Findings client={client} projectId={projectId} version={version} onChanged={reload} />
      <Settings client={client} projectId={projectId} />
      <Reports value={health.value} />
    </PageFrame>
  );
}

function GradeHero({
  value,
  trend,
}: {
  value: ProjectHealth;
  trend: HealthHistory | null;
}): React.ReactElement {
  const { grade } = value;
  const points = (trend?.points ?? [])
    .map((point) => point.score)
    .filter((score): score is number => score !== null);
  return (
    <section
      aria-label="Health grade"
      data-testid="health-hero"
      className="grid gap-4 rounded-xl border border-border-strong bg-surface p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-8 sm:p-8"
    >
      <div className="flex items-baseline gap-3">
        <span
          data-testid="health-letter"
          className={cn(
            'text-7xl font-light leading-none tracking-tight sm:text-8xl',
            letterTone(grade.letter),
          )}
        >
          {grade.incomplete ? '—' : grade.letter}
        </span>
        <span className="tabular-nums text-xl text-fg-muted" data-testid="health-score">
          {grade.score === null ? 'incomplete' : `${grade.score.toFixed(0)} / 100`}
        </span>
      </div>
      <div className="min-w-0 space-y-3">
        <p data-testid="health-limiter" className="text-lg text-pretty sm:text-xl">
          {grade.incomplete ? grade.incompleteReason : grade.limiter}
        </p>
        <ul
          aria-label="Hard gates"
          className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-fg-muted"
        >
          {grade.gates.map((gate) => (
            <li
              key={gate.id}
              className="inline-flex items-center gap-2"
              data-testid={`gate-${gate.id}`}
            >
              <StatusDot
                status={!gate.enabled ? 'unknown' : gate.tripped ? 'bad' : 'good'}
                label={!gate.enabled ? 'disabled' : gate.tripped ? 'tripped' : 'holding'}
              />
              {gate.statement}
              {gate.enabled ? null : <span className="text-xs">(disabled by policy)</span>}
            </li>
          ))}
        </ul>
        {points.length > 1 ? (
          <Sparkline
            points={points}
            label="Health score over 90 days"
            value={`${String(points.length)} readings`}
            className="max-w-xs"
          />
        ) : null}
      </div>
    </section>
  );
}

function DimensionStrip({ value }: { value: ProjectHealth }): React.ReactElement {
  return (
    <section
      aria-label="Dimensions"
      className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 xl:grid-cols-7"
    >
      {value.grade.dimensions.map((entry) => (
        <div
          key={entry.dimension}
          data-testid={`dimension-${entry.dimension}`}
          data-measured={entry.measured ? 'true' : 'false'}
          className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface px-4 py-3"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs font-medium uppercase tracking-wider text-fg-muted">
              {dimensionLabel(entry.dimension)}
            </span>
            <span className={cn('text-2xl font-semibold tabular-nums', letterTone(entry.letter))}>
              {entry.letter ?? '—'}
            </span>
          </div>
          <Meter
            label={`${dimensionLabel(entry.dimension)} score`}
            {...(entry.score === null ? { unmeasured: true } : { value: entry.score })}
            variant={meterVariant(entry.letter)}
          />
          <p className="line-clamp-2 text-xs text-fg-muted" title={entry.summary.join(' · ')}>
            {entry.measured ? (entry.summary[0] ?? '') : 'Not measured'}
          </p>
        </div>
      ))}
    </section>
  );
}

function FixNext({ value }: { value: ProjectHealth }): React.ReactElement {
  const items = value.grade.fixNext;
  return (
    <Panel title="Fix next" data-testid="fix-next">
      {items.length === 0 ? (
        <Quiet>Nothing measured is holding the grade down.</Quiet>
      ) : (
        <ol className="divide-y divide-border">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-baseline justify-between gap-3 py-2"
              data-testid={`fix-${item.key}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm" title={item.title}>
                  {item.helpUri === null ? (
                    item.title
                  ) : (
                    <a
                      href={item.helpUri}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    >
                      {item.title}
                    </a>
                  )}
                </p>
                <p className="text-xs text-fg-muted">
                  {dimensionLabel(item.dimension)}
                  {item.findings > 0
                    ? ` · ${String(item.findings)} finding${item.findings === 1 ? '' : 's'}`
                    : ''}
                </p>
              </div>
              <span className="shrink-0 tabular-nums text-sm text-success">
                +{item.gain.toFixed(1)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function WhatIsGood({ value }: { value: ProjectHealth }): React.ReactElement {
  const good = whatIsGood(value.grade);
  const missing = notMeasured(value.grade);
  return (
    <Panel title="What is good" data-testid="what-is-good">
      {good.length === 0 ? (
        <Quiet>Nothing is at A yet.</Quiet>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {good.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <StatusDot status="good" className="mt-1.5" />
              <span className="min-w-0">{line}</span>
            </li>
          ))}
        </ul>
      )}
      {missing.length === 0 ? null : (
        <p className="mt-3 text-xs text-fg-muted" data-testid="not-measured">
          Not measured: {missing.join(', ')}. No tool reported on them, so they are left out of the
          grade.
        </p>
      )}
    </Panel>
  );
}

function ScanButton({
  client,
  projectId,
  onStarted,
}: {
  client: HealthClient;
  projectId: string;
  onStarted: () => void;
}): React.ReactElement {
  const [state, setState] = React.useState<{ busy: boolean; message: string | null }>({
    busy: false,
    message: null,
  });
  const start = () => {
    setState({ busy: true, message: null });
    client
      .startScan(projectId)
      .then((started) => {
        const missing =
          started.notConfigured.length === 0
            ? ''
            : ` · not installed: ${started.notConfigured.join(', ')}`;
        setState({
          busy: false,
          message: `Scanning with ${started.scanners.join(', ') || 'nothing'}${missing}`,
        });
        onStarted();
      })
      .catch((error: unknown) => {
        const detail = (error as { detail?: unknown }).detail;
        setState({
          busy: false,
          message: typeof detail === 'string' ? detail : 'The scan could not start',
        });
      });
  };
  return (
    <div className="flex items-center gap-3">
      {state.message === null ? null : (
        <span
          role="status"
          className="max-w-xs truncate text-xs text-fg-muted"
          title={state.message}
        >
          {state.message}
        </span>
      )}
      <Button data-testid="health-scan" onClick={start} disabled={state.busy} className="min-h-11">
        {state.busy ? 'Starting…' : 'Scan now'}
      </Button>
    </div>
  );
}

const STATE_OPTIONS: ReadonlyArray<{ value: FindingState | ''; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'suppressed', label: 'Suppressed' },
  { value: 'accepted', label: 'Accepted risk' },
  { value: 'false_positive', label: 'False positive' },
  { value: 'fixed', label: 'Fixed' },
  { value: '', label: 'Any state' },
];

const PAGE = 25;

function Findings({
  client,
  projectId,
  version,
  onChanged,
}: {
  client: HealthClient;
  projectId: string;
  version: number;
  onChanged: () => void;
}): React.ReactElement {
  const [dimension, setDimension] = React.useState<HealthDimension | ''>('');
  const [severity, setSeverity] = React.useState<FindingSeverity | ''>('');
  const [state, setState] = React.useState<FindingState | ''>('open');
  const [q, setQ] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [selected, setSelected] = React.useState<HealthFinding | null>(null);
  const ids = React.useId();
  const page = useResource(
    () =>
      client.getFindings(projectId, {
        dimension: dimension === '' ? undefined : dimension,
        severity: severity === '' ? undefined : severity,
        state: state === '' ? undefined : state,
        q: q.trim() === '' ? undefined : q.trim(),
        limit: PAGE,
        offset,
      }),
    [client, projectId, dimension, severity, state, q, offset, version],
  );
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setOffset(0);
    };
  return (
    <Panel title="Findings" data-testid="findings">
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <Select
          id={`${ids}-dimension`}
          label="Dimension"
          value={dimension}
          onChange={(event) => reset(setDimension)(event.target.value as HealthDimension | '')}
          options={[
            { value: '', label: 'All dimensions' },
            ...HEALTH_DIMENSIONS.map((entry) => ({ value: entry, label: dimensionLabel(entry) })),
          ]}
        />
        <Select
          id={`${ids}-severity`}
          label="Severity"
          value={severity}
          onChange={(event) => reset(setSeverity)(event.target.value as FindingSeverity | '')}
          options={[
            { value: '', label: 'Any severity' },
            ...FINDING_SEVERITIES.map((entry) => ({ value: entry, label: entry })),
          ]}
        />
        <Select
          id={`${ids}-state`}
          label="State"
          value={state}
          onChange={(event) => reset(setState)(event.target.value as FindingState | '')}
          options={STATE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
        />
        <Input
          id={`${ids}-search`}
          label="Search"
          value={q}
          placeholder="Path, rule or message"
          onChange={(event) => reset(setQ)(event.target.value)}
        />
      </div>
      {page.status === 'loading' ? (
        <Skeleton className="h-24 w-full" />
      ) : page.status === 'error' ? (
        <Quiet role="alert">{page.message}</Quiet>
      ) : page.value.total === 0 ? (
        <Quiet data-testid="findings-empty">No findings match.</Quiet>
      ) : (
        <>
          <Table aria-label="Findings">
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead className="hidden md:table-cell">Location</TableHead>
                <TableHead className="hidden sm:table-cell">Tool</TableHead>
                <TableHead className="hidden lg:table-cell">Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.value.findings.map((finding) => (
                <TableRow key={finding.id} data-testid={`finding-${finding.id}`}>
                  <TableCell>
                    <Badge variant={SEVERITY_VARIANT[finding.severity]}>{finding.severity}</Badge>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => setSelected(finding)}
                      className="max-w-[28ch] truncate text-left font-mono text-xs underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                      title={finding.ruleId}
                    >
                      {finding.ruleId}
                    </button>
                  </TableCell>
                  <TableCell
                    className="hidden max-w-[36ch] truncate font-mono text-xs md:table-cell"
                    title={finding.path ?? ''}
                  >
                    {finding.path === null
                      ? '—'
                      : `${finding.path}${finding.line === null ? '' : `:${String(finding.line)}`}`}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{finding.tool}</TableCell>
                  <TableCell className="hidden lg:table-cell">{finding.owner ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-2 flex items-center justify-between text-xs text-fg-muted">
            <span data-testid="findings-range">
              {String(offset + 1)}–{String(offset + page.value.findings.length)} of{' '}
              {String(page.value.total)}
            </span>
            <span className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={offset + PAGE >= page.value.total}
                onClick={() => setOffset(offset + PAGE)}
              >
                Next
              </Button>
            </span>
          </div>
        </>
      )}
      <FindingDrawer
        client={client}
        projectId={projectId}
        finding={selected}
        onClose={() => setSelected(null)}
        onChanged={() => {
          setSelected(null);
          onChanged();
        }}
      />
    </Panel>
  );
}

function FindingDrawer({
  client,
  projectId,
  finding,
  onClose,
  onChanged,
}: {
  client: HealthClient;
  projectId: string;
  finding: HealthFinding | null;
  onClose: () => void;
  onChanged: () => void;
}): React.ReactElement | null {
  const [decision, setDecision] = React.useState<
    'suppressed' | 'accepted' | 'false_positive' | 'open'
  >('accepted');
  const [reason, setReason] = React.useState('');
  const [expires, setExpires] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const ids = React.useId();
  React.useEffect(() => {
    setReason('');
    setExpires('');
    setError(null);
    setDecision(finding?.state === 'open' ? 'accepted' : 'open');
  }, [finding]);
  if (finding === null) return null;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    client
      .triage(projectId, finding.id, {
        state: decision,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
        ...(expires === ''
          ? {}
          : { expiresAt: new Date(`${expires}T00:00:00.000Z`).toISOString() }),
      })
      .then(onChanged)
      .catch((failure: unknown) => {
        const detail = (failure as { detail?: unknown }).detail;
        setError(typeof detail === 'string' ? detail : 'The decision was not saved');
      });
  };
  return (
    <Drawer
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      aria-labelledby="finding-title"
    >
      <DrawerContent data-testid="finding-drawer">
        <DrawerHeader>
          <DrawerTitle id="finding-title" className="break-all font-mono text-base">
            {finding.ruleId}
          </DrawerTitle>
          <p className="text-xs text-fg-muted">
            {finding.tool} · {dimensionLabel(finding.dimension)} · {finding.severity} ·{' '}
            {finding.state.replace('_', ' ')}
          </p>
        </DrawerHeader>
        <div className="space-y-4 text-sm">
          <p className="whitespace-pre-wrap text-pretty">{finding.message}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
            <dt className="text-fg-muted">Location</dt>
            <dd className="break-all font-mono">
              {finding.path ?? '—'}
              {finding.line === null ? '' : `:${String(finding.line)}`}
            </dd>
            <dt className="text-fg-muted">First seen</dt>
            <dd>{ago(finding.firstSeenAt)}</dd>
            <dt className="text-fg-muted">Last seen</dt>
            <dd>{ago(finding.lastSeenAt)}</dd>
            <dt className="text-fg-muted">Owner</dt>
            <dd>{finding.owner ?? 'Unowned'}</dd>
            {finding.triageReason === null ? null : (
              <>
                <dt className="text-fg-muted">Decision</dt>
                <dd>
                  {finding.triageReason}
                  {finding.triageExpiresAt === null
                    ? ''
                    : ` · until ${finding.triageExpiresAt.slice(0, 10)}`}
                </dd>
              </>
            )}
          </dl>
          {finding.helpUri === null ? null : (
            <a
              href={finding.helpUri}
              target="_blank"
              rel="noreferrer"
              className="inline-block underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              How to fix — the rule's own documentation
            </a>
          )}
          <form
            onSubmit={submit}
            className="space-y-3 border-t border-border pt-4"
            aria-label="Triage"
          >
            <Select
              id={`${ids}-decision`}
              label="Decision"
              value={decision}
              onChange={(event) => setDecision(event.target.value as typeof decision)}
              options={[
                { value: 'accepted', label: 'Accept the risk' },
                { value: 'suppressed', label: 'Suppress' },
                { value: 'false_positive', label: 'False positive' },
                { value: 'open', label: 'Reopen' },
              ]}
            />
            {decision === 'open' ? null : (
              <Textarea
                id={`${ids}-reason`}
                label="Reason"
                value={reason}
                required
                onChange={(event) => setReason(event.target.value)}
              />
            )}
            {decision === 'accepted' || decision === 'suppressed' ? (
              <Input
                id={`${ids}-expires`}
                label={decision === 'accepted' ? 'Expires (required)' : 'Expires (optional)'}
                type="date"
                value={expires}
                required={decision === 'accepted'}
                onChange={(event) => setExpires(event.target.value)}
              />
            ) : null}
            {error === null ? null : (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button type="submit" data-testid="triage-submit">
                Save decision
              </Button>
            </div>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Reports({ value }: { value: ProjectHealth }): React.ReactElement {
  return (
    <Panel title="Evidence" data-testid="health-reports">
      {value.reports.length === 0 ? (
        <Quiet>
          No report has been received. Run a scan, or upload SARIF and metric reports from CI to{' '}
          <span className="font-mono">/api/v1/projects/{value.projectId}/health/reports</span>.
        </Quiet>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {value.reports.map((report) => (
            <li
              key={report.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
            >
              <span className="font-mono text-xs">
                {report.tools
                  .map((tool) => `${tool.name}${tool.version === null ? '' : ` ${tool.version}`}`)
                  .join(', ') || report.format}
              </span>
              <span className="text-xs text-fg-muted">
                {report.format} · {report.source}
                {report.commitSha === null ? '' : ` · ${report.commitSha.slice(0, 7)}`} ·{' '}
                {ago(report.receivedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const CADENCES = [
  { value: 'off', label: 'Off' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
] as const;
type Cadence = (typeof CADENCES)[number]['value'];

/** The scheduled scan and where alerts go. Operators change it; the API refuses anyone else. */
function Settings({
  client,
  projectId,
}: {
  client: HealthClient;
  projectId: string;
}): React.ReactElement {
  const settings = useResource<HealthSettings>(
    () => client.getSettings(projectId),
    [client, projectId],
  );
  const [slack, setSlack] = React.useState('');
  const [webhook, setWebhook] = React.useState('');
  const [message, setMessage] = React.useState<{ text: string; failed: boolean } | null>(null);
  const ids = React.useId();
  React.useEffect(() => {
    if (settings.status !== 'ready') return;
    setSlack(settings.value.alerts.slackChannel ?? '');
    setWebhook(settings.value.alerts.webhookUrl ?? '');
  }, [settings]);
  const fail = (failure: unknown) => {
    const detail = (failure as { detail?: unknown }).detail;
    setMessage({ text: typeof detail === 'string' ? detail : 'Not saved', failed: true });
  };
  const schedule = (cadence: Cadence) => {
    client
      .setSchedule(projectId, cadence === 'off' ? null : cadence)
      .then((result) =>
        setMessage({
          text:
            result.cadence === null
              ? 'Scheduled scans are off.'
              : `Scanning ${result.cadence} with ${result.scanners.join(', ') || 'no installed scanner'}. Save again after installing another.`,
          failed: false,
        }),
      )
      .catch(fail);
  };
  const saveAlerts = (event: React.FormEvent) => {
    event.preventDefault();
    client
      .setAlerts(projectId, {
        slackChannel: slack.trim() === '' ? null : slack.trim(),
        webhookUrl: webhook.trim() === '' ? null : webhook.trim(),
      })
      .then(() => setMessage({ text: 'Alerts saved.', failed: false }))
      .catch(fail);
  };
  if (settings.status !== 'ready') {
    return (
      <Panel title="Schedule and alerts">
        {settings.status === 'loading' ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <Quiet role="alert">{settings.message}</Quiet>
        )}
      </Panel>
    );
  }
  return (
    <Panel title="Schedule and alerts" data-testid="health-settings">
      <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-end">
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Scheduled scan</span>
          <Segmented
            label="Scheduled scan"
            options={CADENCES}
            value={(settings.value.schedule ?? 'off') as Cadence}
            onChange={schedule}
          />
        </div>
        <form
          onSubmit={saveAlerts}
          className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
          aria-label="Alerts"
        >
          <Input
            id={`${ids}-slack`}
            label="Slack channel"
            placeholder="#quality"
            value={slack}
            onChange={(event) => setSlack(event.target.value)}
          />
          <Input
            id={`${ids}-webhook`}
            label="Webhook (https, signed)"
            placeholder="https://…"
            value={webhook}
            onChange={(event) => setWebhook(event.target.value)}
          />
          <Button type="submit" variant="secondary" className="min-h-10">
            Save alerts
          </Button>
        </form>
      </div>
      <p className="mt-2 text-xs text-fg-muted">
        Alerts fire when the default branch's grade falls or a new critical finding appears.
        {settings.value.codeowners ? ' Owners come from the uploaded CODEOWNERS.' : ''}
      </p>
      {message === null ? null : (
        <p
          role="status"
          className={cn('mt-2 text-sm', message.failed ? 'text-danger' : 'text-fg-muted')}
        >
          {message.text}
        </p>
      )}
    </Panel>
  );
}
