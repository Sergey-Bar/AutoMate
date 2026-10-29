import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Minus,
  cn,
} from '@automate/ui';
import type { Verdict } from '../lib/insights.js';

/**
 * The redesign's five building blocks: a page frame, a panel, a figure, a pager and a
 * segmented control.
 *
 * ## Why these live in the application and not in `packages/ui`
 *
 * They encode one screen language — a fixed-viewport page of quiet panels with one large
 * number each — rather than a general primitive. Every panel is flat: one opaque plane
 * step, a hairline, no shadow. Colour inside a panel is a verdict or nothing.
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
  // Fitted to the viewport at every width. Wide screens lay their panels out side by side;
  // narrow ones show the same panels as tabs (`Responsive`), so no width needs a scroll.
  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-3 sm:gap-4', className)} {...props}>
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
    <header className="flex shrink-0 flex-wrap items-end justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h1>
        {subtitle === undefined ? null : (
          <div
            className="mt-0.5 max-w-measure text-sm leading-relaxed text-fg-muted"
            title={typeof subtitle === 'string' ? subtitle : undefined}
          >
            {subtitle}
          </div>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
      )}
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
        'flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-surface p-4 sm:p-5',
        className,
      )}
      {...props}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <h2 id={id} className="text-xs font-medium uppercase tracking-wider text-fg-muted">
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

/**
 * One figure: a label, a large value, an optional sparkline, and the delta beneath it.
 *
 * Compact on a phone — a smaller figure and one line of footer — so six of them sit in two
 * rows above the fold rather than three.
 */
export function Kpi({
  label,
  value,
  unit,
  footer,
  tone,
  spark,
  hero = false,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  label: string;
  value: string;
  unit?: string;
  footer?: React.ReactNode;
  tone?: string;
  /** A small trend drawn beside the figure, from wide screens up. */
  spark?: React.ReactNode;
  /**
   * The one figure a screen leads with: a lighter, larger numeral and a lifted card. One per
   * screen at most — two heroes is no hero.
   */
  hero?: boolean;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col justify-between rounded-xl border bg-surface px-4 py-3 sm:px-5 sm:py-4',
        hero ? 'border-border-strong' : 'border-border',
      )}
      data-hero={hero ? '' : undefined}
      {...props}
    >
      <div
        className="truncate text-xs font-medium uppercase tracking-wider text-fg-muted"
        title={label}
      >
        {label}
      </div>
      <div className="mt-0.5 flex items-end justify-between gap-2 sm:mt-1">
        <div className={cn('flex min-w-0 items-baseline gap-1', tone)}>
          <span
            className={cn(
              'truncate tabular-nums tracking-tight',
              hero
                ? 'text-3xl font-semibold sm:text-4xl xl:text-5xl'
                : 'text-2xl font-semibold sm:text-3xl',
            )}
            title={unit === undefined ? value : `${value} ${unit}`}
          >
            {value}
          </span>
          {unit === undefined ? null : <span className="text-sm text-fg-muted">{unit}</span>}
        </div>
        {spark === undefined ? null : <div className="hidden shrink-0 2xl:block">{spark}</div>}
      </div>
      {/*
        The footer is a node (a delta, a sentence), so its tooltip is read from what it
        rendered: a narrow tile truncates it, and the title is how the rest stays readable.
      */}
      <div
        ref={(element) => titleFromText(element)}
        className="mt-0.5 min-h-4 truncate text-xs text-fg-muted sm:mt-1"
      >
        {footer}
      </div>
    </div>
  );
}

/**
 * Sets an element's `title` to its own text, for a box that may truncate a node. A fresh
 * callback each render, so React re-runs it whenever the footer re-renders.
 */
function titleFromText(element: HTMLElement | null): void {
  if (element === null) return;
  const text = element.textContent.trim();
  if (text.length > 0) element.title = text;
  else element.removeAttribute('title');
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

/**
 * How many rows of `rowPx` fit in the element `ref` points at, kept current as it resizes.
 *
 * For a list inside a panel whose height comes from the layout, where the window height
 * says little about the panel's. Every page is fitted at every width now, so the panel's
 * height is always the layout's and never the list's own. `offsetPx` is the part of the
 * box that is not rows — a table head. Without `ResizeObserver` (jsdom) it answers
 * `fallback`.
 */
export function useFitCount(
  rowPx: number,
  fallback: number,
  offsetPx = 0,
): [number, (element: HTMLElement | null) => void] {
  // A callback ref rather than a ref object, so a list that mounts after a loading state is
  // measured when it appears rather than never.
  const [element, setElement] = React.useState<HTMLElement | null>(null);
  const [count, setCount] = React.useState(fallback);
  React.useEffect(() => {
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const height = element.clientHeight - offsetPx;
      setCount(height > 0 ? Math.max(1, Math.floor(height / rowPx)) : fallback);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, rowPx, fallback, offsetPx]);
  return [count, setElement];
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
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-lg border border-border bg-surface-muted p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-11 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors duration-200 motion-reduce:transition-none sm:px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
            option.value === value
              ? 'bg-surface text-fg ring-1 ring-border'
              : 'text-fg-muted hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A coloured dot, always beside a word that says the same thing. One copy, in the library. */
export { StatusDot } from '@automate/ui';

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

/**
 * A paged list as a component, for the places a hook cannot be called directly — a render
 * callback, or a branch below an early return.
 */
export function Paged<T>({
  items,
  reservedPx,
  rowPx = 52,
  headerPx = 44,
  label,
  children,
}: {
  items: readonly T[];
  /** Used only where the box cannot be measured, to estimate the rows from the window. */
  reservedPx: number;
  rowPx?: number;
  /** The part of the box that is not rows: a table head. */
  headerPx?: number;
  label: string;
  children: (page: T[]) => React.ReactNode;
}): React.ReactElement {
  const estimate = useViewportRows(reservedPx, rowPx);
  const [size, box] = useFitCount(rowPx, estimate, headerPx);
  const pager = usePager(items, size);
  return (
    <>
      <div ref={box} className="min-h-0 flex-1 overflow-hidden">
        {children(pager.items)}
      </div>
      <PagerControls pager={pager} label={label} />
    </>
  );
}

/** Copies text, and says so for two seconds where the reader is looking. */
export function CopyButton({ text, label }: { text: string; label: string }): React.ReactElement {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      title={copied ? 'Copied' : `Copy: ${text}`}
      onClick={() => void copy()}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
    >
      {copied ? (
        <Check size={14} aria-hidden="true" className="text-success" />
      ) : (
        <Copy size={14} aria-hidden="true" />
      )}
    </button>
  );
}
