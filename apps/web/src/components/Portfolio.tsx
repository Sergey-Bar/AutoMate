import React from 'react';
import {
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@automate/ui';
import type { Portfolio as PortfolioPayload, PortfolioEntry } from '@automate/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import type { HealthClient } from '../lib/health-client.js';
import { ago, dimensionLabel, letterTone } from '../lib/health-view.js';
import { repoHealthPath } from '../route-manifest.js';
import { Delta, PageFrame, PageHeader, Panel } from './kit.js';
import { StatusLine } from './StatusLine.js';

/**
 * Every repository, worst first: the page anyone opening the dashboard lands on.
 *
 * One answer up top — how many repositories need attention — and a quiet list beneath it.
 * Each row is the grade, what limits it, and where it is heading; the detail is one click
 * away on the repository's own page.
 */
export function Portfolio({ health }: { health: HealthClient }): React.ReactElement {
  const portfolio = useResource<PortfolioPayload>(() => health.getPortfolio(), [health]);
  if (portfolio.status === 'loading') {
    return (
      <PageFrame data-testid="portfolio-loading">
        <PageHeader title="Portfolio" />
        <Skeleton className="h-40 w-full" />
      </PageFrame>
    );
  }
  if (portfolio.status === 'error') {
    return (
      <PageFrame>
        <PageHeader title="Portfolio" />
        <EmptyState
          headingLevel={2}
          title="Could not read the portfolio"
          description={portfolio.message}
        />
      </PageFrame>
    );
  }
  const entries = [...portfolio.value.projects].sort(worstFirst);
  const attention = entries.filter(needsAttention).length;
  const graded = entries.filter((entry) => entry.letter !== null).length;
  return (
    <PageFrame data-testid="portfolio" className="h-auto gap-4 sm:gap-6">
      <PageHeader
        title="Portfolio"
        subtitle={`${String(entries.length)} repositor${entries.length === 1 ? 'y' : 'ies'} · ${String(graded)} graded`}
      />
      {entries.length === 0 ? (
        <EmptyState
          headingLevel={2}
          data-testid="portfolio-empty"
          title="No repository is registered"
          description="Register a repository, then run a scan or upload its scanner reports from CI."
        />
      ) : (
        <>
          <StatusLine
            data-testid="portfolio-attention"
            value={String(attention)}
            tone={attention > 0 ? 'caution' : 'good'}
            sentence={
              attention === 1
                ? 'repository needs attention: graded C or below, or incomplete.'
                : 'repositories need attention: graded C or below, or incomplete.'
            }
            action={
              entries[0] !== undefined && attention > 0
                ? { label: `Open ${entries[0].name}`, href: repoHealthPath(entries[0].projectId) }
                : undefined
            }
          />
          <p className="text-sm text-fg-muted" data-testid="portfolio-improving">
            {String(entries.filter((entry) => (entry.trend ?? 0) > 0).length)} improving over 30
            days
          </p>
          <Panel title="Repositories" data-testid="portfolio-table">
            <Table aria-label="Repositories">
              <TableHeader>
                <TableRow>
                  <TableHead>Repository</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="hidden md:table-cell">Limited by</TableHead>
                  <TableHead className="hidden sm:table-cell">30 days</TableHead>
                  <TableHead className="hidden lg:table-cell">Weakest</TableHead>
                  <TableHead className="hidden lg:table-cell">Last report</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <PortfolioRow key={entry.projectId} entry={entry} />
                ))}
              </TableBody>
            </Table>
          </Panel>
        </>
      )}
    </PageFrame>
  );
}

function scoreText(entry: PortfolioEntry): string {
  if (entry.score !== null) return entry.score.toFixed(0);
  return entry.incomplete ? 'incomplete' : '';
}

function TrendCell({ trend }: { trend: number | null }): React.ReactElement {
  if (trend === null) return <span className="text-xs text-fg-muted">—</span>;
  const verdict = trend > 0 ? 'better' : trend < 0 ? 'worse' : 'same';
  return (
    <Delta
      text={`${trend > 0 ? '+' : ''}${trend.toFixed(1)}`}
      verdict={verdict}
      rising={trend === 0 ? null : trend > 0}
    />
  );
}

function PortfolioRow({ entry }: { entry: PortfolioEntry }): React.ReactElement {
  return (
    <TableRow data-testid={`portfolio-row-${entry.slug}`}>
      <TableCell>
        <a
          href={repoHealthPath(entry.projectId)}
          className="font-medium underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          {entry.name}
        </a>
      </TableCell>
      <TableCell>
        <span className={cn('text-xl font-semibold tabular-nums', letterTone(entry.letter))}>
          {entry.letter ?? '—'}
        </span>
        <span className="ml-2 text-xs tabular-nums text-fg-muted">{scoreText(entry)}</span>
      </TableCell>
      <TableCell
        className="hidden max-w-[48ch] truncate text-sm text-fg-muted md:table-cell"
        title={entry.limiter ?? ''}
      >
        {entry.limiter ?? 'No report yet'}
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <TrendCell trend={entry.trend} />
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        {entry.worst === null ? '—' : dimensionLabel(entry.worst)}
      </TableCell>
      <TableCell className="hidden text-xs text-fg-muted lg:table-cell">
        {ago(entry.lastReportAt)}
      </TableCell>
    </TableRow>
  );
}

const LETTER_RANK: Record<string, number> = { F: 0, D: 1, C: 2, B: 3, A: 4, 'A+': 5 };

/** Incomplete and ungraded first, then the worst letter, then the lowest score. */
export function worstFirst(left: PortfolioEntry, right: PortfolioEntry): number {
  const rank = (entry: PortfolioEntry) =>
    entry.letter === null ? -1 : (LETTER_RANK[entry.letter] ?? -1);
  return (
    rank(left) - rank(right) ||
    (left.score ?? -1) - (right.score ?? -1) ||
    left.name.localeCompare(right.name)
  );
}

export function needsAttention(entry: PortfolioEntry): boolean {
  return (
    entry.letter === null || entry.letter === 'C' || entry.letter === 'D' || entry.letter === 'F'
  );
}
