import React from 'react';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  OctagonX,
  StatusDot,
  cn,
  type DotStatus,
} from '@automate/ui';
import {
  WRONG_SHOWN,
  type Finding,
  type FindingTone,
  type HealthSummary,
} from '../lib/health-summary.js';
import type { ReleaseReadinessCard } from '../lib/qa.js';

/**
 * Release readiness, as the first thing on the Overview.
 *
 * ## The verdict is a word, an icon and a colour, never only a colour
 *
 * "Go", "Caution" and "No-go" are spelled out at display size and carry their own glyph, so
 * the verdict survives a monochrome display, a colour-vision deficiency and a screen
 * reader. On a monochrome plane it is also the largest colour on the screen, which is the
 * point: it is the one thing the reader came to learn. The verdict itself is computed by
 * `evaluateReadiness` in `@automate/reporting`; this file only draws it.
 */
const VERDICT = {
  go: { label: 'Go', Icon: CircleCheck, tone: 'text-success' },
  caution: { label: 'Caution', Icon: CircleAlert, tone: 'text-warning' },
  'no-go': { label: 'No-go', Icon: OctagonX, tone: 'text-danger' },
} as const;

const DOT: Record<FindingTone, DotStatus> = {
  bad: 'bad',
  warn: 'warn',
  unknown: 'unknown',
  good: 'good',
};

const TONE_WORD: Record<FindingTone, string> = {
  bad: 'Blocks',
  warn: 'Warns',
  unknown: 'Unknown',
  good: 'Passes',
};

/** The reason the card leads with: the worst one, or a sentence that everything passed. */
export function headline(card: ReleaseReadinessCard): string {
  const [first] = card.reasons;
  if (first === undefined || first.level === 'go') return 'Every readiness check passes';
  return first.message;
}

export function VerdictHero({
  summary,
  failure,
}: {
  summary: HealthSummary | null;
  failure: string | null;
}): React.ReactElement {
  const verdict = summary?.verdict == null ? null : VERDICT[summary.verdict];
  return (
    <section
      aria-label="Release readiness"
      data-testid="readiness-hero"
      className="shrink-0 rounded-xl border border-border bg-surface px-5 py-6 sm:px-8 sm:py-8"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
        Release readiness
      </p>
      {verdict === null || summary === null ? (
        <p data-testid="readiness-pending" className="mt-3 text-lg text-fg-muted">
          {failure === null ? 'Reading release readiness…' : `Readiness unread: ${failure}`}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p
              data-testid="readiness-verdict"
              className={cn(
                'inline-flex items-center gap-3 text-5xl font-semibold tracking-tighter sm:text-6xl',
                verdict.tone,
              )}
            >
              <verdict.Icon size={44} strokeWidth={1.75} aria-hidden="true" />
              {verdict.label}
            </p>
            <p className="mt-3 max-w-measure text-pretty text-lg text-fg">{summary.headline}</p>
          </div>
          <p data-testid="readiness-counts" className="shrink-0 text-sm tabular-nums text-fg-muted">
            {`${String(summary.wrong.length)} to look at · ${String(summary.good.length)} passing`}
          </p>
        </div>
      )}
    </section>
  );
}

/** "What's wrong" beside "What's good". Stacked on a phone, side by side from `md`. */
export function FindingsColumns({ summary }: { summary: HealthSummary }): React.ReactElement {
  return (
    <div data-testid="findings" className="grid shrink-0 grid-cols-1 gap-3 md:grid-cols-2 sm:gap-4">
      <FindingList
        testId="findings-wrong"
        title="What’s wrong"
        items={summary.wrong}
        empty="Nothing is wrong that Automate can see."
      />
      <FindingList
        testId="findings-good"
        title="What’s good"
        items={summary.good}
        empty="Nothing has passed yet."
      />
    </div>
  );
}

function FindingList({
  testId,
  title,
  items,
  empty,
}: {
  testId: string;
  title: string;
  items: readonly Finding[];
  empty: string;
}): React.ReactElement {
  const id = React.useId();
  const listId = React.useId();
  const [all, setAll] = React.useState(false);
  const shown = all ? items : items.slice(0, WRONG_SHOWN);
  return (
    <section
      aria-labelledby={id}
      data-testid={testId}
      className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-5"
    >
      <h2 id={id} className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-fg-muted">{title}</span>
        <span className="text-2xl font-semibold tabular-nums text-fg">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">{empty}</p>
      ) : (
        <ul id={listId} className="mt-3 divide-y divide-border">
          {shown.map((item) => (
            <li key={item.id} className="flex min-w-0 items-start gap-3 py-3">
              <StatusDot status={DOT[item.tone]} className="mt-1.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg">
                  <span className="sr-only">{`${TONE_WORD[item.tone]}: `}</span>
                  {item.title}
                </p>
                <p className="truncate font-mono text-xs text-fg-muted" title={item.evidence}>
                  {item.evidence}
                </p>
              </div>
              <Link
                {...item.action}
                aria-label={`${item.action.label}: ${item.title}`}
                className="-my-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg no-underline hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              >
                {item.action.label}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {items.length > WRONG_SHOWN ? (
        <button
          type="button"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll((value) => !value)}
          className="mt-2 inline-flex min-h-11 items-center self-start rounded-md px-2 text-sm font-medium text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          {all ? 'Show fewer' : `Show all ${String(items.length)}`}
        </button>
      ) : null}
    </section>
  );
}
