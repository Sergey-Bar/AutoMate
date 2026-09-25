import { forwardRef, type HTMLAttributes } from 'react';
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

export interface SplitterProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof splitterVariants> {}

export const Splitter = forwardRef<HTMLDivElement, SplitterProps>(
  ({ className, orientation = 'horizontal', ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="separator"
        aria-orientation={orientation === 'horizontal' ? 'horizontal' : 'vertical'}
        className={cn(splitterVariants({ orientation, className }))}
        {...props}
      />
    );
  }
);
Splitter.displayName = 'Splitter';
