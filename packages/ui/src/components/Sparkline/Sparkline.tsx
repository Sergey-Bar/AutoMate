import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * A trend, drawn.
 *
 * ## What this is for
 *
 * Three screens in this product had the same shape: "here is a sequence, here is its
 * current value, here is a word for the direction". Each drew it by hand as an `<svg>` of
 * hardcoded numbers, which is a primitive with three copies and no accessible name.
 *
 * **A sparkline shows shape, and that is its whole claim.** It has no axes, no scale and
 * no gridlines, because the moment it has a y-axis it is a chart and it needs tick labels,
 * a legend and a title. So it is not a chart and must not be read as one: what it answers
 * is "was this getting better or worse", and a value beside it in tabular figures answers
 * "by how much". The two together are a reading; the sparkline alone is a gesture.
 *
 * ## The four properties, and why each is chosen
 *
 * 1. **`role="img"` with a required `label`.** A polyline is a picture to a screen reader,
 *    and a picture with no name is silence. The name is required by the type, not
 *    optional, for the same reason `Meter`'s is.
 * 2. **A fixed 96×32 box, drawn in.** The height is 32px and the path is drawn in that
 *    space, so a sparkline cannot grow to fill a card and become a chart by accident. It is
 *    also why the stroke is 1.5px: at 32px tall, 2px is half the height of a flat line and
 *    a flat series becomes a bar.
 * 3. **A flat series is drawn, not skipped.** Three points at the same value produce a
 *    horizontal line, which is the truth; a naive min/max normalisation divides by zero and
 *    draws nothing, which reads as "no data" and is the one thing this component must never
 *    do.
 * 4. **One `value` and one `trend`, applied to the label rather than to the geometry.** The
 *    shape carries no numbers; the numbers live in the value beside it.
 */
export interface SparklineProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The series, oldest first. One point is allowed and draws a single dot. */
  points: readonly number[];
  /** The accessible name. Says what the series *is*, not what it looks like. */
  label: string;
  /** The trailing value, appended to the name so the shape has its number. */
  value?: string;
  /** Where the series is going, when the caller knows. Appended to the name. */
  trend?: 'up' | 'down' | 'flat';
  /** Stroke and dot colour, as a text token. Defaults to `text-fg-muted`. */
  tone?: string;
}

export const Sparkline = forwardRef<HTMLDivElement, SparklineProps>(
  ({ points, label, value, trend, tone, className, ...props }, ref) => {
    const placed = placedPoints(points);
    const path = sparkPath(placed);
    const last = placed.at(-1);
    const accessibleName = [label, value, trend === undefined ? undefined : `trending ${trend}`]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join(', ');
    return (
      <div
        ref={ref}
        role="img"
        aria-label={accessibleName}
        className={cn('inline-flex', className)}
        {...props}
      >
        <svg
          data-testid="sparkline-svg"
          className={cn('h-8 w-24', tone ?? 'text-fg-muted')}
          viewBox="0 0 96 32"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          {path === undefined ? null : (
            <path
              data-testid="sparkline-path"
              d={path}
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {last === undefined ? null : (
            <circle
              data-testid="sparkline-dot"
              cx={last.x}
              cy={last.y}
              r={1.75}
              fill="currentColor"
            />
          )}
        </svg>
      </div>
    );
  },
);
Sparkline.displayName = 'Sparkline';

const WIDTH = 96;
const HEIGHT = 32;
const PADDING = 2;

interface Point {
  x: number;
  y: number;
}

/**
 * The path for a placed series.
 *
 * A one-point series draws an `M` and nothing else, which renders as nothing — so the dot
 * beside it is the whole mark. That is honest: one point has no shape.
 */
function sparkPath(placed: readonly Point[]): string | undefined {
  const first = placed[0];
  if (first === undefined) return undefined;
  return placed
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${String(point.x)} ${String(point.y)}`)
    .join(' ');
}

/**
 * Map a series into the 96×32 box.
 *
 * **The flat-series branch is the point of this function.** With every value equal the
 * minimum and the maximum are the same number and the usual normalisation divides by zero;
 * the naive version returns nothing and the component draws an empty box, which reads as
 * "no data" rather than as "no change". So the span is at least 1 and a flat series lands
 * on the vertical centre, which is where a horizontal line belongs.
 */
function placedPoints(points: readonly number[]): Point[] {
  const usable = points.filter((point) => Number.isFinite(point));
  const first = usable[0];
  if (usable.length === 0 || first === undefined) return [];
  const min = Math.min(...usable);
  const max = Math.max(...usable);
  const span = Math.max(1, max - min);
  const usableWidth = WIDTH - PADDING * 2;
  const usableHeight = HEIGHT - PADDING * 2;
  const step = usable.length === 1 ? 0 : usableWidth / (usable.length - 1);
  return usable.map((point, index) => ({
    x: PADDING + step * index,
    y: PADDING + usableHeight - ((point - min) / span) * usableHeight + 1,
  }));
}
