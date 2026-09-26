import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';
import type { HTMLAttributes } from 'react';

export const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-accent',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-accent text-fg hover:opacity-80',
        secondary: 'border-transparent bg-surface-muted text-fg hover:opacity-80',
        danger: 'border-transparent bg-danger text-fg hover:opacity-80',
        success: 'border-transparent bg-success text-fg hover:opacity-80',
        warning: 'border-transparent bg-warning text-fg hover:opacity-80',
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
