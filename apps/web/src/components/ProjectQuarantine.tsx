import React from 'react';
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type BadgeProps,
} from '@automate/ui';
import type {
  ProjectQuarantine as ProjectQuarantineView,
  QuarantineMode,
} from '@automate/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import type { HealthClient } from '../lib/health-client.js';
import { Panel, Quiet, Segmented } from './kit.js';

/**
 * A project's quarantine, and the one decision about it: whether this install may quarantine
 * flaky tests on its own.
 *
 * Each row says who owns the test (CODEOWNERS), what it has cost (retries and the time they
 * took), how long it has been held out, and how far it is from release. The policy control
 * is admin-only on the server; a refusal is shown, not hidden.
 */

const MODES: ReadonlyArray<{ value: QuarantineMode; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'suggest', label: 'Suggest' },
  { value: 'auto', label: 'Auto' },
];

const MODE_SENTENCE: Record<QuarantineMode, string> = {
  off: 'Flaky tests are not suggested for quarantine.',
  suggest: 'Flaky tests are suggested; a person approves each one.',
  auto: 'A test that passes on a retry quarantines itself, and is released after a clean streak.',
};

const STATUS_TONE: Record<
  ProjectQuarantineView['entries'][number]['status'],
  BadgeProps['variant']
> = {
  approved: 'success',
  rejected: 'danger',
  pending: 'warning',
  released: 'default',
};

export function seconds(ms: number): string {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${String(Math.round(ms / 60_000))} min`;
}

export function ProjectQuarantine({
  health: client,
  projectId,
}: {
  health: HealthClient;
  projectId: string;
}): React.ReactElement {
  const [version, setVersion] = React.useState(0);
  const [failure, setFailure] = React.useState<string | null>(null);
  const view = useResource<ProjectQuarantineView>(
    () => client.getProjectQuarantine(projectId),
    [client, projectId, version],
  );

  const choose = (mode: QuarantineMode) => {
    if (view.status !== 'ready') return;
    setFailure(null);
    client
      .setQuarantinePolicy(projectId, { ...view.value.policy, mode })
      .then(() => setVersion((value) => value + 1))
      .catch((caught: unknown) =>
        setFailure(caught instanceof Error ? caught.message : String(caught)),
      );
  };

  return (
    <Panel title="Quarantine" data-testid="project-quarantine">
      {view.status === 'loading' ? (
        <Quiet>Reading the quarantine…</Quiet>
      ) : view.status === 'error' ? (
        <Quiet data-testid="project-quarantine-error">{view.message}</Quiet>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label="Quarantine policy"
              value={view.value.policy.mode}
              options={MODES}
              onChange={choose}
            />
            <p className="text-sm text-fg-muted" data-testid="project-quarantine-policy">
              {MODE_SENTENCE[view.value.policy.mode]}
              {view.value.policy.mode === 'auto'
                ? ` Release after ${String(view.value.policy.releaseAfter)} clean passes.`
                : ''}
            </p>
          </div>
          {failure === null ? null : (
            <p role="alert" className="text-sm text-error" data-testid="project-quarantine-refused">
              {failure}
            </p>
          )}
          {view.value.entries.length === 0 ? (
            <Quiet>No test of this project is quarantined.</Quiet>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Cost ({String(view.value.windowDays)} days)</TableHead>
                  <TableHead>Held</TableHead>
                  <TableHead>Toward release</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.value.entries.map((entry) => (
                  <TableRow key={entry.id} data-testid={`project-quarantine-${entry.id}`}>
                    <TableCell>
                      <span className="block">{entry.testTitle}</span>
                      <span className="block font-mono text-xs text-fg-muted">
                        {entry.stableId ?? entry.testFile}
                      </span>
                    </TableCell>
                    <TableCell>{entry.owner ?? 'no owner'}</TableCell>
                    <TableCell>
                      {`${String(entry.retriesSpent)} retries · ${seconds(entry.wastedMs)} · ${String(entry.blockedRuns)} blocked`}
                    </TableCell>
                    <TableCell>{`${String(entry.daysQuarantined)} d`}</TableCell>
                    <TableCell>
                      {entry.status === 'approved' && entry.quarantinedBy === 'automate'
                        ? `${String(entry.cleanStreak)} / ${String(view.value.policy.releaseAfter)}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONE[entry.status]}>
                        {entry.quarantinedBy === 'automate'
                          ? `${entry.status} · auto`
                          : entry.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </Panel>
  );
}
