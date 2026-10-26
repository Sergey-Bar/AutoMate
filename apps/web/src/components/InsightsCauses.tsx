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
type Suggestions = NonNullable<QaInsights['quarantineSuggestions']>;
type Suggestion = Suggestions['suggestions'][number];

export function FailureClustersPanel({
  clusters,
}: {
  clusters: QaInsights['failureClusters'];
}): React.ReactElement {
  return (
    <Panel title="Failures by root cause" data-testid="failure-clusters" className="flex-1">
      {clusters === undefined ? (
        <Quiet data-testid="clusters-unreported">This API does not group failures by cause.</Quiet>
      ) : (
        <ClusterList clusters={clusters} />
      )}
    </Panel>
  );
}

function ClusterList({ clusters }: { clusters: Clusters }): React.ReactElement {
  if (clusters.totals.failures === 0) {
    return <Quiet>No test failed in this window.</Quiet>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <p data-testid="clusters-summary" className="text-sm font-medium tabular-nums">
        {clusters.summary}
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
            <p className="text-xs text-fg-muted">
              {`${String(cluster.tests.length)} test${cluster.tests.length === 1 ? '' : 's'} · ${String(cluster.runs)} run${cluster.runs === 1 ? '' : 's'} · ${cluster.branches.join(', ')} · last ${shortDate(cluster.lastSeen.slice(0, 10))}`}
            </p>
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
