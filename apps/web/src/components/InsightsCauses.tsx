import React from 'react';
import { Button } from '@automate/ui';
import type { ApiClient } from '../lib/api.js';
import { formatDuration, shortDate } from '../lib/insights.js';
import type { QaInsights } from '../lib/qa.js';
import { failureText } from '../lib/roles.js';
import { Panel, Quiet } from './kit.js';
import { useToast } from './Toasts.js';

/**
 * Two answers the run history gives once failures are grouped: how many root causes there
 * really are, and which flaky tests cost enough to quarantine.
 *
 * Both are computed by the server (`clusterFailures` and `suggestQuarantine` in
 * `@automate/reporting`) and both are optional on the wire, so an older API's answer says
 * "not reported" rather than drawing an empty list that reads as "nothing failed".
 */
type Clusters = NonNullable<QaInsights['failureClusters']>;
type Cluster = Clusters['clusters'][number];
type Suggestions = NonNullable<QaInsights['quarantineSuggestions']>;
type Suggestion = Suggestions['suggestions'][number];
type Category = NonNullable<NonNullable<Cluster['label']>['category']>;

const CATEGORY_LABEL: Record<Category, string> = {
  product: 'Product bug',
  test: 'Test bug',
  environment: 'Environment',
  'known-issue': 'Known issue',
};

export function FailureClustersPanel({
  clusters,
  api,
}: {
  clusters: QaInsights['failureClusters'];
  /** Absent: labels are shown and cannot be changed here. */
  api?: Pick<ApiClient, 'setTriageLabel'>;
}): React.ReactElement {
  return (
    <Panel title="Failures by root cause" data-testid="failure-clusters" className="flex-1">
      {clusters === undefined ? (
        <Quiet data-testid="clusters-unreported">This API does not group failures by cause.</Quiet>
      ) : (
        <ClusterList clusters={clusters} api={api} />
      )}
    </Panel>
  );
}

/**
 * The label of one cause: what the team decided it is. Changing it labels every recurrence,
 * because the server keys it on the cause's signature, not on this list.
 */
function CauseLabel({
  cluster,
  api,
}: {
  cluster: Cluster;
  api: Pick<ApiClient, 'setTriageLabel'> | undefined;
}): React.ReactElement | null {
  const toast = useToast();
  const [category, setCategory] = React.useState<Category | ''>(cluster.label?.category ?? '');
  if (api === undefined) {
    return category === '' ? null : (
      <span className="text-xs text-fg-muted">{CATEGORY_LABEL[category]}</span>
    );
  }
  const choose = (next: Category) => {
    const previous = category;
    setCategory(next);
    api
      .setTriageLabel({ signature: cluster.signature, category: next })
      .then(() => toast({ tone: 'success', title: `Labelled ${CATEGORY_LABEL[next]}` }))
      .catch((error: unknown) => {
        setCategory(previous);
        toast({
          tone: 'danger',
          title: 'Could not label the cause',
          description: failureText(error, 'the label was not saved'),
        });
      });
  };
  return (
    <select
      aria-label="Label this cause"
      data-testid="cause-label"
      value={category}
      onChange={(event) => choose(event.target.value as Category)}
      className="min-h-11 rounded-md border border-border-default bg-surface px-2 text-xs text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
    >
      <option value="" disabled>
        Unlabelled
      </option>
      {(Object.keys(CATEGORY_LABEL) as Category[]).map((value) => (
        <option key={value} value={value}>
          {CATEGORY_LABEL[value]}
        </option>
      ))}
    </select>
  );
}

function ClusterList({
  clusters,
  api,
}: {
  clusters: Clusters;
  api: Pick<ApiClient, 'setTriageLabel'> | undefined;
}): React.ReactElement {
  if (clusters.totals.failures === 0) {
    return <Quiet>No test failed in this window.</Quiet>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <p data-testid="clusters-summary" className="text-sm font-medium tabular-nums">
        {clusters.summary}
        {clusters.totals.unlabelled === undefined
          ? ''
          : ` · ${String(clusters.totals.unlabelled)} unlabelled`}
      </p>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto text-sm">
        {clusters.clusters.map((cluster) => (
          <li key={cluster.signature} data-testid="failure-cluster">
            <p className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-xs" title={cluster.sampleMessage}>
                {cluster.errorType === null
                  ? cluster.sampleMessage
                  : `${cluster.errorType}: ${cluster.sampleMessage}`}
              </span>
              <span className="shrink-0 tabular-nums text-xs text-danger">
                {`${String(cluster.count)} failure${cluster.count === 1 ? '' : 's'}`}
              </span>
            </p>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-fg-muted">
                {`${String(cluster.tests.length)} test${cluster.tests.length === 1 ? '' : 's'} · ${String(cluster.runs)} run${cluster.runs === 1 ? '' : 's'} · ${cluster.branches.join(', ')} · last ${shortDate(cluster.lastSeen.slice(0, 10))}`}
              </p>
              <CauseLabel cluster={cluster} api={api} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The file half of the server's `file › title` key, or the placeholder the quarantine list uses. */
export function fileOf(testKey: string): string {
  const [file] = testKey.split(' › ');
  return file === undefined || file.trim() === '' || file === testKey ? '(unknown file)' : file;
}

export function QuarantineSuggestionsPanel({
  suggestions,
  api,
}: {
  suggestions: QaInsights['quarantineSuggestions'];
  api: ApiClient;
}): React.ReactElement {
  return (
    <Panel title="Worth quarantining" data-testid="quarantine-suggestions" className="flex-1">
      {suggestions === undefined ? (
        <Quiet data-testid="suggestions-unreported">This API does not suggest quarantines.</Quiet>
      ) : suggestions.suggestions.length === 0 ? (
        <Quiet>
          {`No test is flaky enough: the bar is a score of ${String(Math.round(suggestions.thresholds.minScore * 100))}% over at least ${String(suggestions.thresholds.minObservations)} runs.`}
        </Quiet>
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {suggestions.suggestions.map((suggestion) => (
            <SuggestionRow key={suggestion.testKey} suggestion={suggestion} api={api} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SuggestionRow({
  suggestion,
  api,
}: {
  suggestion: Suggestion;
  api: ApiClient;
}): React.ReactElement {
  const toast = useToast();
  const [state, setState] = React.useState<'idle' | 'busy' | 'done'>('idle');
  const quarantine = () => {
    setState('busy');
    api
      .addQuarantine({
        testTitle: suggestion.title,
        testFile: fileOf(suggestion.testKey),
        // The identity, so the entry is about this project and describe path only.
        stableId: suggestion.testKey,
        reason: suggestion.reason,
      })
      .then(() => {
        setState('done');
        toast({ tone: 'success', title: `Quarantined ${suggestion.title}` });
      })
      .catch((error: unknown) => {
        setState('idle');
        toast({
          tone: 'danger',
          title: 'Not quarantined',
          description: failureText(error, 'The quarantine was refused'),
        });
      });
  };
  return (
    <li data-testid="quarantine-suggestion" className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm" title={suggestion.testKey}>
          {suggestion.title}
        </p>
        <p className="text-xs text-fg-muted">{suggestion.reason}</p>
        <p className="tabular-nums text-xs text-fg-muted">
          {`${String(Math.round(suggestion.flakyScore * 100))}% flaky · ${String(suggestion.retriesSpent)} retries · ${formatDuration(suggestion.wastedMs)} wasted · ${String(suggestion.blockedRuns)} runs blocked`}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={state !== 'idle'}
        onClick={quarantine}
        aria-label={
          state === 'done' ? `${suggestion.title} is quarantined` : `Quarantine ${suggestion.title}`
        }
        className="min-h-11 shrink-0"
      >
        {state === 'done' ? 'Quarantined' : 'Quarantine'}
      </Button>
    </li>
  );
}
