import React from 'react';
import {
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@automate/ui';
import type {
  HealthLetter,
  HeatmapCell,
  HeatmapScorecard,
  PortfolioHeatmap as HeatmapPayload,
  ScorecardId,
  ScorecardStatus,
} from '@automate/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import type { HealthClient } from '../lib/health-client.js';
import { dimensionLabel } from '../lib/health-view.js';
import { SCORECARD_STATUS_WORD } from '../lib/scorecard-view.js';
import { repoHealthPath } from '../route-manifest.js';
import { Panel, Quiet } from './kit.js';

/**
 * Every repository against every grade dimension and every scorecard, on one grid.
 *
 * A heatmap that is only colour is a heatmap a screen reader, a colour-blind reader and a
 * printed page cannot read, so **every cell carries its value in text** — the letter and the
 * score, or the scorecard's verdict — and the colour is the verdict's token tint behind it,
 * never the only signal. An unmeasured cell is muted and says so; it is never tinted green.
 */
export const SCORECARD_LABELS: Readonly<Record<ScorecardId, string>> = {
  delivery: 'DORA',
  flow: 'Flow',
  'supply-chain': 'Supply chain',
  'test-effectiveness': 'Test effectiveness',
  'ai-code': 'AI code',
  'agent-quality': 'Agent quality',
};

const MUTED = 'text-fg-muted';

/** The token tint for a letter. Colour is a verdict or nothing. */
export function letterCellTone(letter: HealthLetter | null): string {
  switch (letter) {
    case 'A+':
    case 'A':
      return 'bg-success/10 text-success';
    case 'B':
      return 'bg-surface-muted text-fg';
    case 'C':
    case 'D':
      return 'bg-warning/10 text-warning';
    case 'F':
      return 'bg-danger/10 text-danger';
    default:
      return MUTED;
  }
}

const STATUS_TONE: Readonly<Record<ScorecardStatus, string>> = {
  pass: 'bg-success/10 text-success',
  fail: 'bg-danger/10 text-danger',
  insufficient: MUTED,
  not_configured: MUTED,
};

/** A dimension cell's text: `A 92`, or `not measured`. */
export function dimensionCellText(cell: HeatmapCell): string {
  if (!cell.measured || cell.score === null) return 'not measured';
  return `${cell.letter ?? '—'} ${cell.score.toFixed(0)}`;
}

/** A scorecard cell's text: `82 · Pass`, or the verdict alone when there is no score. */
export function scorecardCellText(card: Pick<HeatmapScorecard, 'status' | 'score'>): string {
  const word = SCORECARD_STATUS_WORD[card.status];
  return card.score === null ? word : `${card.score.toFixed(0)} · ${word}`;
}

export function PortfolioHeatmap({ health }: { health: HealthClient }): React.ReactElement {
  const heatmap = useResource<HeatmapPayload>(() => health.getHeatmap(), [health]);
  return (
    <Panel title="Heatmap" data-testid="portfolio-heatmap">
      {heatmap.status === 'loading' ? (
        <Skeleton className="h-32 w-full" data-testid="portfolio-heatmap-loading" />
      ) : heatmap.status === 'error' ? (
        <Quiet>{`Could not read the heatmap: ${heatmap.message}`}</Quiet>
      ) : (
        <HeatmapTable value={heatmap.value} />
      )}
    </Panel>
  );
}

function HeatmapTable({ value }: { value: HeatmapPayload }): React.ReactElement {
  if (value.projects.length === 0) return <Quiet>No repository is registered.</Quiet>;
  return (
    <>
      {value.truncated ? (
        <p className="mb-2 text-xs text-fg-muted" data-testid="portfolio-heatmap-truncated">
          {`Showing the first ${String(value.projects.length)} of ${String(value.total)} repositories, by name.`}
        </p>
      ) : null}
      <Table aria-label="Heatmap: every dimension and scorecard per repository">
        <caption className="sr-only">
          Each repository's grade dimensions as letter and score, then each scorecard's score and
          verdict.
        </caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Repository</TableHead>
            {value.dimensions.map((dimension) => (
              <TableHead key={dimension} scope="col" className="text-xs whitespace-nowrap">
                {dimensionLabel(dimension)}
              </TableHead>
            ))}
            {value.scorecards.map((id) => (
              <TableHead key={id} scope="col" className="text-xs whitespace-nowrap">
                {SCORECARD_LABELS[id]}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {value.projects.map((project) => (
            <TableRow key={project.projectId} data-testid={`heatmap-row-${project.slug}`}>
              <th scope="row" className="px-4 py-2 text-left font-medium whitespace-nowrap">
                <a
                  href={repoHealthPath(project.projectId)}
                  className="underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                >
                  {project.name}
                </a>
              </th>
              {project.dimensions.map((cell) => (
                <TableCell
                  key={cell.dimension}
                  data-testid={`heatmap-${project.slug}-dim-${cell.dimension}`}
                  className={cn(
                    'text-xs tabular-nums whitespace-nowrap',
                    cell.measured ? letterCellTone(cell.letter) : MUTED,
                  )}
                >
                  {dimensionCellText(cell)}
                </TableCell>
              ))}
              {project.scorecards.map((card) => (
                <TableCell
                  key={card.id}
                  data-testid={`heatmap-${project.slug}-card-${card.id}`}
                  className={cn('text-xs tabular-nums whitespace-nowrap', STATUS_TONE[card.status])}
                >
                  {scorecardCellText(card)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
