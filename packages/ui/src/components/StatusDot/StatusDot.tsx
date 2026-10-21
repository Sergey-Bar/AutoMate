import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

export type DotStatus = 'good' | 'warn' | 'bad' | 'info' | 'unknown';

const TONE: Record<DotStatus, string> = {
  good: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-danger',
  info: 'bg-info',
  // Hollow, so "we do not know" never reads as a fourth verdict colour.
  unknown: 'ring-1 ring-fg-muted',
};

export interface StatusDotProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: DotStatus;
  /**
   * The status in words, for a dot that stands alone. Without it the dot is decorative and
   * the caller must put the same word beside it — colour is never the only carrier.
   */
  label?: string;
  /** A pulse for something in progress. Stops under `prefers-reduced-motion`. */
  live?: boolean;
}

/**
 * The one place a verdict colour is drawn as a mark.
 *
 * Eight pixels, round, from the status token. The monochrome plane means this dot is very
 * often the only colour in a row, so it is what the eye finds first — and it is always
 * paired with a word, either the caller's or its own `aria-label`.
 */
export const StatusDot = forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ status, label, live = false, className, ...props }, ref) => (
    <span
      ref={ref}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        TONE[status],
        live && 'animate-automate-pulse motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  ),
);
StatusDot.displayName = 'StatusDot';
