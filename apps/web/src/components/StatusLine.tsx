import React from 'react';
import { Button, cn } from '@automate/ui';

/**
 * One big number, one sentence, one action.
 *
 * The page header pattern for the screens a person opens to decide what to do: the number
 * is the answer, the sentence says what it counts, and the action is the next step. Three
 * KPIs side by side ask the reader to compare; one asks them to act.
 */
export function StatusLine({
  value,
  sentence,
  tone,
  action,
  'data-testid': testId,
}: {
  value: string;
  sentence: string;
  tone: 'good' | 'caution' | 'bad';
  action?:
    | { label: string; onSelect: () => void; href?: undefined }
    | { label: string; href: string; onSelect?: undefined }
    | undefined;
  'data-testid'?: string;
}): React.ReactElement {
  return (
    <section
      aria-label="Status"
      data-testid={testId}
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
    >
      <div className="flex items-baseline gap-4">
        <span
          className={cn(
            'text-6xl font-semibold tabular-nums tracking-tight',
            tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-warning',
          )}
        >
          {value}
        </span>
        <span className="text-base text-fg-muted">{sentence}</span>
      </div>
      {action === undefined ? null : action.href !== undefined ? (
        <a
          href={action.href}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-on-fill hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          {action.label}
        </a>
      ) : (
        <Button className="min-h-11" onClick={action.onSelect}>
          {action.label}
        </Button>
      )}
    </section>
  );
}
