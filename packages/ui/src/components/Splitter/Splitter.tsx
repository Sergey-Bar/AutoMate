import { forwardRef, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const splitterVariants = cva('bg-border shrink-0', {
  variants: {
    orientation: {
      horizontal: 'h-px w-full',
      vertical: 'h-full w-px',
    },
  },
  defaultVariants: {
    orientation: 'horizontal',
  },
});

/** How far one Arrow key press moves the divider, in percentage points. */
export const SPLITTER_STEP = 5;

export interface SplitterProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'>, VariantProps<typeof splitterVariants> {
  /** Divider position as a percentage of the container, clamped to min/max. */
  value?: number;
  min?: number;
  max?: number;
  /** Accessible name. A separator with no name is announced as just "separator". */
  label?: string;
  onValueChange?: (value: number) => void;
}

export const Splitter = forwardRef<HTMLDivElement, SplitterProps>(
  (
    {
      className,
      orientation = 'horizontal',
      value = 50,
      min = 0,
      max = 100,
      label = 'Resize panes',
      onValueChange,
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    const current = Math.min(max, Math.max(min, value));
    const vertical = orientation === 'vertical';

    /**
     * Keyboard resize.
     *
     * A `role="separator"` that is focusable is the window-splitter pattern, and
     * the pattern's whole point is that it can be moved from the keyboard. The
     * previous version was a focusable-less `<div role="separator">`: it looked
     * like a divider, announced itself as a separator, and could not be reached
     * or operated by anyone not using a mouse. Arrow keys step, `Home`/`End`
     * jump to the bounds, and the axis matches `aria-orientation` so ArrowUp and
     * ArrowDown are meaningful for a vertical divider.
     */
    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const decreaseKey = vertical ? 'ArrowUp' : 'ArrowLeft';
      const increaseKey = vertical ? 'ArrowDown' : 'ArrowRight';

      let next: number | undefined;
      if (event.key === 'Home') next = min;
      else if (event.key === 'End') next = max;
      else if (event.key === decreaseKey) next = current - SPLITTER_STEP;
      else if (event.key === increaseKey) next = current + SPLITTER_STEP;

      if (next === undefined) {
        onKeyDown?.(event);
        return;
      }

      event.preventDefault();
      const clamped = Math.min(max, Math.max(min, next));
      onKeyDown?.(event);
      if (clamped !== current) onValueChange?.(clamped);
    };

    return (
      <div
        ref={ref}
        role="separator"
        // Focusable, because a separator the keyboard cannot reach is a divider
        // the keyboard cannot move. `aria-valuenow` and friends are what make it
        // a *window splitter* rather than a static separator.
        tabIndex={0}
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-label={label}
        aria-valuenow={current}
        aria-valuemin={min}
        aria-valuemax={max}
        onKeyDown={handleKeyDown}
        className={cn(splitterVariants({ orientation, className }))}
        {...props}
      />
    );
  },
);
Splitter.displayName = 'Splitter';
