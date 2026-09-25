import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const emptyStateVariants = cva(
  'flex w-full flex-col items-center justify-center p-8 text-center animate-in fade-in duration-500',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        card: 'bg-bg-elevated rounded-xl border border-border-default shadow-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export type EmptyStateVariants = VariantProps<typeof emptyStateVariants>;

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement>, EmptyStateVariants {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  'data-testid'?: string;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, variant, icon, title, description, action, 'data-testid': testId = 'empty-state', ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-testid={testId}
        className={cn(emptyStateVariants({ variant, className }))}
        {...props}
      >
        {icon && (
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-bg-elevated text-text-secondary">
            {icon}
          </div>
        )}
        <h3 className="mb-1 text-lg font-semibold text-text-primary">{title}</h3>
        <p className="mb-6 max-w-sm text-sm text-text-secondary">{description}</p>
        {action && <div>{action}</div>}
      </div>
    );
  }
);

EmptyState.displayName = 'EmptyState';
