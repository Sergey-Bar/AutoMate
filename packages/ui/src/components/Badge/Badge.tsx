import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';
import type { HTMLAttributes } from 'react';

export const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
  {
    variants: {
      variant: {
        // `text-on-fill` rather than `text-fg`: these variants paint the token
        // across the whole badge, so the label needs a foreground chosen for that
        // fill, and `text-fg` is the foreground for a *surface*.
        default: 'border-transparent bg-accent text-on-fill hover:opacity-80',
        secondary: 'border-transparent bg-surface-muted text-fg hover:opacity-80',
        danger: 'border-transparent bg-danger text-on-fill hover:opacity-80',
        success: 'border-transparent bg-success text-on-fill hover:opacity-80',
        warning: 'border-transparent bg-warning text-on-fill hover:opacity-80',
        outline: 'text-fg border-border',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
