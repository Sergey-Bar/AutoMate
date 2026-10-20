import React from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Minus, cn } from '@automate/ui';
import type { Verdict } from '../lib/insights.js';

/**
 * The redesign's five building blocks: a page frame, a panel, a figure, a pager and a
 * segmented control.
 *
 * ## Why these live in the application and not in `packages/ui`
 *
 * They encode one screen language — a fixed-viewport page of quiet panels with one large
 * number each — rather than a general primitive. `Card` and `StatCard` in the library are
 * glass, and glass inside a page made of panels stacks a blur on a blur, which the design
 * language refuses. These panels are opaque `surface-raised`, so the only glass on a page
 * is the navigation bar above it.
 *
 * ## The no-scroll rule, and where it is kept
 *
 * `PageFrame` fills the height the shell gives it and every panel is `min-h-0`, so a page
 * is laid out *into* the viewport rather than down the document. A list that could grow
 * without bound is paged with `usePager` instead of scrolled, and a pager states its range
 * so "eight of forty" is never mistaken for "eight".
 */
export function PageFrame({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-4', className)} {...props}>
      {children}
    </div>
  );
}

/** A page's title row: the `h1`, one line of context, and the page's actions on the right. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}): React.ReactElement {
  return (
    <header className="flex shrink-0 flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-3xl font-light tracking-tight">{title}</h1>
        {subtitle === undefined ? null : (
          <div className="mt-1 max-w-measure truncate text-sm text-fg-muted">{subtitle}</div>
        )}
      </div>
      {actions === undefined ? null : <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLElement>, 'title'> & {
  title: string;
  action?: React.ReactNode;
}): React.ReactElement {
  const id = React.useId();
  return (
    <section
      aria-labelledby={id}
      className={cn(
        'flex min-h-0 flex-col rounded-2xl border border-border bg-surface-raised p-4',
        className,
      )}
      {...props}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <h2 id={id} className="text-xs font-medium uppercase tracking-widest text-fg-muted">
          {title}
        </h2>
        {action}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

const VERDICT_TONE: Record<Verdict, string> = {
  better: 'text-success',
  worse: 'text-danger',
  same: 'text-fg-muted',
  unknown: 'text-fg-muted',
};

/**
 * A change, with its direction drawn and its verdict in colour **and** in words.
 *
 * The words are the accessible half: a red arrow is a colour and a shape, and neither
 * reaches a screen reader. `sr-only` carries "better" or "worse" so the verdict is read
 * aloud rather than inferred.
 */
export function Delta({
  text,
  verdict,
  rising,
}: {
  text: string;
  verdict: Verdict;
  /** Which way the number moved, independent of whether that is good. */
  rising: boolean | null;
}): React.ReactElement {
  const Icon = rising === null ? Minus : rising ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 text-xs tabular-nums', VERDICT_TONE[verdict])}
    >
      {verdict === 'unknown' ? null : <Icon size={12} aria-hidden="true" />}
      {text}
      {verdict === 'better' || verdict === 'worse' ? (
        <span className="sr-only">{` (${verdict})`}</span>
      ) : null}
    </span>
  );
}

/** One figure: a label, a large value, and the sentence or delta beneath it. */
export function Kpi({
  label,
  value,
  unit,
  footer,
  tone,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  label: string;
  value: string;
  unit?: string;
  footer?: React.ReactNode;
  tone?: string;
}): React.ReactElement {
  return (
    <div
      className="flex min-w-0 flex-col justify-between rounded-2xl border border-border bg-surface-raised px-4 py-3"
      {...props}
    >
      <div className="truncate text-xs font-medium uppercase tracking-widest text-fg-muted">
        {label}
      </div>
      <div className={cn('mt-1 flex items-baseline gap-1', tone)}>
        <span className="tabular-nums text-4xl font-light tracking-tight">{value}</span>
        {unit === undefined ? null : <span className="text-sm text-fg-muted">{unit}</span>}
      </div>
      <div className="mt-1 min-h-4 truncate text-xs text-fg-muted">{footer}</div>
    </div>
  );
}

/**
 * How many rows of `rowPx` fit in the viewport once `reservedPx` of chrome is taken.
 *
 * A fixed page size is wrong at both ends: on a 768px laptop it overflows, and on a
 * 1080p monitor it leaves half the panel empty. Recomputed on resize, and never below
 * `min`, so a short window still shows a useful page rather than one row.
 */
export function useViewportRows(reservedPx: number, rowPx: number, min = 4): number {
  const measure = React.useCallback(
    () => Math.max(min, Math.floor((window.innerHeight - reservedPx) / rowPx)),
    [min, reservedPx, rowPx],
  );
  const [rows, setRows] = React.useState(measure);
  React.useEffect(() => {
    const update = () => setRows(measure());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [measure]);
  return rows;
}

export interface Pager<T> {
  page: number;
  pages: number;
  items: T[];
  from: number;
  to: number;
  total: number;
  next: () => void;
  previous: () => void;
}

/** A page of `items`, clamped so a shrinking list never leaves the reader on an empty page. */
export function usePager<T>(items: readonly T[], size: number): Pager<T> {
  const [requested, setPage] = React.useState(0);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(requested, pages - 1);
  const start = page * size;
  return {
    page,
    pages,
    items: items.slice(start, start + size),
    from: items.length === 0 ? 0 : start + 1,
    to: Math.min(start + size, items.length),
    total: items.length,
    next: () => setPage(Math.min(page + 1, pages - 1)),
    previous: () => setPage(Math.max(page - 1, 0)),
  };
}

export function PagerControls<T>({
  pager,
  label,
}: {
  pager: Pager<T>;
  label: string;
}): React.ReactElement | null {
  if (pager.total === 0) return null;
  return (
    <nav aria-label={`${label} pages`} className="flex shrink-0 items-center justify-end gap-1">
      <span className="mr-1 tabular-nums text-xs text-fg-muted" aria-live="polite">
        {`${String(pager.from)}–${String(pager.to)} of ${String(pager.total)}`}
      </span>
      <button
        type="button"
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        onClick={pager.previous}
        disabled={pager.page === 0}
        aria-label={`Previous ${label} page`}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        onClick={pager.next}
        disabled={pager.page >= pager.pages - 1}
        aria-label={`Next ${label} page`}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}

/** A one-of-N choice drawn as a pill row, with `aria-pressed` carrying the state. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}): React.ReactElement {
  return (
    <div role="group" aria-label={label} className="flex rounded-full bg-surface-muted p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-11 rounded-full px-4 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
            option.value === value ? 'bg-surface-raised text-fg' : 'text-fg-muted hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const STATUS_TONE = {
  good: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-danger',
  info: 'bg-fg-muted',
} as const;

/** A coloured dot, always beside a word that says the same thing. */
export function StatusDot({ status }: { status: keyof typeof STATUS_TONE }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', STATUS_TONE[status])}
    />
  );
}

/** A loading or failed state that keeps the page's shape rather than collapsing it. */
export function Quiet({
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-fg-muted" {...props}>
      {children}
    </div>
  );
}
