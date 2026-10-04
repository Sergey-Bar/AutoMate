import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * A pair of terms and their values, and the markup that says so.
 *
 * **The reason this primitive exists.** Seven screens in this product render a
 * key/value pair as a `<div>` and a `<div>` — a limiter's row, a queue entry's
 * three-term explanation, an onboarding step's two ways in, a run's provenance. Every one
 * of those is a definition list, and `<div>` is not one: a screen reader announces two
 * unstructured strings where a reader could have been told "depth, 0.80" as a unit.
 *
 * `<dl>`/`<dt>`/`<dd>` costs the same to write and is the only markup that carries the
 * relation. The visual is a two-column grid rather than a stack, because the values are
 * compared down a column and a stacked pair makes that impossible — which is the same
 * argument as the numeric `TableCell`, applied to prose.
 *
 * ## Typography
 *
 * The detail column is `max-w-measure`: a closure description is a sentence and a
 * sentence is what the measure is a ceiling on. The term column is `text-sm` and the
 * detail is `text-sm` too, because a definition list where the two sides differ in size
 * reads as a heading rather than as a pair.
 */
export const DefinitionList = forwardRef<HTMLDListElement, HTMLAttributes<HTMLDListElement>>(
  ({ className, ...props }, ref) => (
    <dl
      ref={ref}
      className={cn('grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-6 gap-y-2', className)}
      {...props}
    />
  ),
);
DefinitionList.displayName = 'DefinitionList';

/** One term. Renders as `<dt>`, which is what makes the pair a pair. */
export const DefinitionListTerm = forwardRef<HTMLElement, React.ComponentPropsWithoutRef<'dt'>>(
  ({ className, ...props }, ref) => (
    <dt
      ref={ref}
      className={cn('text-sm font-medium text-fg-muted text-pretty', className)}
      {...props}
    />
  ),
);
DefinitionListTerm.displayName = 'DefinitionListTerm';

/**
 * One value. Renders as `<dd>`.
 *
 * `font-mono tabular-nums`, because the values in this product are figures, digests,
 * paths and durations — and a duration or a count in a proportional face is a figure that
 * shifts sideways as it updates. A caller whose value is a sentence passes
 * `className="font-sans"` rather than the primitive gaining a `mono` prop, because that is
 * a decision about *this* value rather than a variant of the component.
 *
 * **No `max-w-measure` here, and that is deliberate.** The measure is a ceiling on *prose*,
 * and a `<dd>` in this product holds a digest, a duration, a path or a sentence — so
 * capping it would be capping a figure as though it were a sentence, which is the specific
 * mistake `--max-w-measure`'s own comment in `theme.css` warns about. The grid's
 * `minmax(0, 1fr)` detail column already bounds the width, so a sentence here wraps without
 * a ceiling it does not need.
 */
export const DefinitionListDetail = forwardRef<HTMLElement, React.ComponentPropsWithoutRef<'dd'>>(
  ({ className, ...props }, ref) => (
    <dd
      ref={ref}
      className={cn('font-mono text-sm tabular-nums text-pretty text-fg', className)}
      {...props}
    />
  ),
);
DefinitionListDetail.displayName = 'DefinitionListDetail';
