import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

/**
 * A bar that reports a proportion, and the three states a bar can be in.
 *
 * ## Why `role="meter"` and not a div
 *
 * `role="meter"` is the ARIA role for "a numeric value within a known range", and it is a
 * different thing from `role="progressbar"` — a progressbar says work is happening, a
 * meter says a value is what it is and will not change on its own. A coverage bar in a QA
 * console is a meter: 72% is a fact about the repository, not a task running. Getting
 * that wrong makes a screen reader announce work in progress for a number that will not
 * move.
 *
 * ## The three states, and the one that matters
 *
 * A bar has a third state that is not a low value: **no measurement**. The Cockpit drew it
 * as a solid bar in a muted ink, which reads as a failed image load, and every assertion
 * about that cell was about *which colour* it used — and it correctly used none. `Meter`
 * makes it a prop instead of a colour, so the state has to be named:
 *
 * - `unmeasured={false}` — a fill in the variant's colour, at `value * 100` percent.
 * - `unmeasured={true}` — **no fill at all.** A dashed outline at 1px in the muted ink,
 *   same width as a full bar. This is the state that cannot be mistaken for a bar, and
 *   `Meter.test.tsx` asserts the rendered geometry rather than a class name.
 * - `value` omitted — treated as `unmeasured`, because a bar with no value is not a bar
 *   with a value of zero. Zero is a measurement; absent is an absence.
 *
 * ## Why the fill is a transform, not a width
 *
 * The fill is a child scaled on the X axis with `transform-origin: left`, not a
 * percentage width. Animating or repainting a width is a layout pass for the bar and the
 * subtree behind it; a transform on a composited layer is free per frame. The product
 * repaints these bars on every poll, so the difference is the difference between a smooth
 * refresh and a visible hitch.
 */
const meterVariants = cva('text-fg-muted', {
  variants: {
    variant: {
      neutral: 'text-fg-muted',
      accent: 'text-accent',
      success: 'text-success',
      warning: 'text-warning',
      danger: 'text-danger',
    },
  },
  defaultVariants: {
    variant: 'neutral',
  },
});

export interface MeterProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'>, VariantProps<typeof meterVariants> {
  /** The proportion, 0–1. Omit it — or pass `unmeasured` — when nothing was measured. */
  value?: number;
  /** Draw the empty outline instead of a fill. */
  unmeasured?: boolean;
  /**
   * The accessible name.
   *
   * Required rather than optional, because a bar with no name is a coloured rectangle:
   * `role="meter"` with no `aria-label` announces a number and nothing about what it is a
   * number *of*. The label belongs here so it cannot be left to a parent that may not know
   * either.
   */
  label: string;
}

export const Meter = forwardRef<HTMLDivElement, MeterProps>(
  ({ className, variant, value, unmeasured, label, ...props }, ref) => {
    const empty = unmeasured === true || value === undefined || !Number.isFinite(value);
    // Clamped rather than trusted: a bar at 140% either overflows its track or silently
    // becomes 100%, and both are a wrong number drawn confidently.
    const clamped = Math.min(1, Math.max(0, value ?? 0));
    const percent = Math.round(clamped * 100);
    return (
      <div
        ref={ref}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={empty ? undefined : percent}
        aria-valuetext={empty ? 'not measured' : `${percent}%`}
        className={cn('h-3 w-full', meterVariants({ variant }), className)}
        {...props}
      >
        {/*
          The track. `border-current` rather than a `border-*` colour, so the empty state
          inherits whatever variant the caller chose and a meter cannot be drawn in a
          colour it was not given.
        */}
        <span
          data-testid="meter-track"
          className={cn(
            'block h-full w-full overflow-hidden rounded-full border border-current',
            !empty && 'border-transparent',
          )}
        >
          {!empty && (
            <span
              data-testid="meter-fill"
              className="block h-full w-full origin-left rounded-full bg-current"
              style={{ transform: `scaleX(${clamped})` }}
            />
          )}
          {empty && (
            <span
              data-testid="meter-empty"
              aria-hidden="true"
              className="block h-full w-full rounded-full border border-dashed border-current"
            />
          )}
        </span>
      </div>
    );
  },
);
Meter.displayName = 'Meter';
