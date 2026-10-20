import React from 'react';
import { createRoute } from '@tanstack/react-router';
import {
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@automate/ui';
import { Route as dashboardRoute } from '../dashboard.js';
import { createQaClient, type QaClient } from '../../lib/qa-client.js';
import type { QaScore } from '../../lib/qa.js';
import { useResource } from '../../hooks/useResource.js';
import { Kpi, PageFrame, PageHeader, Panel } from '../../components/kit.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/score/$projectId',
  // The client is a **prop**, not a module singleton. That is the convention every
  // other dashboard route here follows, and it is what lets this component be
  // rendered in a test without a module mock — a singleton would have to be replaced
  // before the module loaded, which is a test that passes or fails on import order.
  component: () => {
    const { projectId } = Route.useParams();
    return <ScorePage api={createQaClient()} projectId={projectId} />;
  },
});

/**
 * The health score, rendered with the row that limited it.
 *
 * ## The capping cell is **not optional** in this component
 *
 * The total is a weighted *geometric* mean. That choice is what makes it trustworthy
 * — a zero anywhere forces the total to zero, so five perfect categories cannot
 * average away a repository with no security testing. And it is exactly what makes
 * the total alone undiagnosable: the reader cannot tell which term dragged it down,
 * so a big number on its own is a claim with nothing behind it.
 *
 * So `cappingCell` is computed from the same payload the total came from and
 * rendered on the same screen, and there is no branch that renders the total
 * without it. A component that showed the number alone would be showing an
 * arithmetic score's worth of information from a geometric formula, and the reader
 * would have no reason to distrust it.
 */
export function ScorePage({
  api,
  projectId,
}: {
  api: QaClient;
  projectId: string;
}): React.ReactElement {
  // The shared hook, not a fourth copy of the fetch-and-render skeleton. It *was* a
  // copy, and the copy is how this screen came to render `error.message` — "API
  // answered 404" — where its sibling screens rendered the server's own sentence.
  const resource = useResource<QaScore>(() => api.getScore(projectId), [api, projectId]);
  if (resource.status === 'loading') return <Skeleton />;
  if (resource.status === 'error') {
    return (
      <PageFrame>
        <PageHeader title="Health score" />
        <EmptyState title="Could not load the score" description={resource.message} />
      </PageFrame>
    );
  }

  const score = resource.value;
  const capping = cappingCell(score);
  return (
    <PageFrame aria-label="Health score">
      <PageHeader title="Health score" subtitle={`Read at ${score.at}`} />
      <section aria-label="Score figures" className="grid shrink-0 gap-3 md:grid-cols-3">
        <Kpi
          label="Health score"
          value={`${score.total.toFixed(1)}/100`}
          footer="weighted geometric mean"
        />
        {/* The limiter, on the same screen as the number it explains. */}
        <div className="flex min-w-0 flex-col justify-between rounded-2xl border border-accent bg-surface-raised px-4 py-3 md:col-span-2">
          <div className="text-xs font-medium uppercase tracking-widest text-fg-muted">
            What is capping this score
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-2xl">{capping.row}</span>
            <span className="tabular-nums text-2xl text-danger">{capping.value.toFixed(2)}</span>
          </div>
          <p className="mt-1 max-w-measure text-pretty text-xs text-fg-muted">{capping.reason}</p>
        </div>
      </section>
      <Matrix score={score} />
    </PageFrame>
  );
}

export interface CappingCell {
  row: string;
  value: number;
  /** One sentence naming what the row is worth, because a label is not a reason. */
  reason: string;
}

/**
 * The limiting row, read from the payload's own `cappedBy`/`cappingValue`.
 *
 * Not recomputed from the rows. The server resolved it with the weights it actually
 * used, and a client that re-derived it would be a second implementation of the mean —
 * the exact thing this product exists to avoid.
 */
export function cappingCell(score: QaScore): CappingCell {
  const value = score.cappingValue;
  const reason =
    value === 0
      ? 'This row contributes a zero. Because the total is a geometric mean, a zero anywhere forces the total to zero — five perfect rows cannot average it away.'
      : `This row contributes the most shortfall to the weighted geometric mean. Closing it moves the total more than any other row.`;
  return { row: score.cappedBy, value, reason };
}

/** The 6×3 matrix, one row per category. */
function Matrix({ score }: { score: QaScore }): React.ReactElement {
  const categories = [...new Set(score.cells.map((cell) => cell.category))];
  const surfaces = ['backend', 'frontend', 'platform'] as const;
  return (
    <Panel title="Matrix" className="flex-1">
      <p className="mb-2 max-w-measure text-pretty text-xs text-fg-muted">
        Every cell carries its own components, so no number here is unexplained.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Category</TableHead>
            {surfaces.map((surface) => (
              <TableHead key={surface}>{surface}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.map((category) => (
            <TableRow key={category}>
              <TableCell>{category}</TableCell>
              {surfaces.map((surface) => {
                const cell = score.cells.find(
                  (candidate) => candidate.category === category && candidate.surface === surface,
                );
                return (
                  <TableCell key={surface} numeric>
                    {cell === undefined ? '—' : formatCell(cell)}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

/**
 * One cell, as `score` plus its four components.
 *
 * The components are shown because a sub-score with no breakdown is a number the
 * reader has to take on trust, and a QA number taken on trust is worth less than no
 * QA number at all.
 */
export function formatCell(cell: {
  score: number;
  presence: number;
  depth: number;
  stability: number;
  signal: number;
  excluded: boolean;
}): string {
  if (cell.excluded) return 'n/a';
  if (cell.presence === 0) return '0 (no suite)';
  return `${cell.score.toFixed(2)} (P${cell.presence.toFixed(0)} D${cell.depth.toFixed(2)} S${cell.stability.toFixed(2)} Q${cell.signal.toFixed(2)})`;
}
