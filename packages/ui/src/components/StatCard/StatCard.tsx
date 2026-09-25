import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  value: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  description?: ReactNode;
}

export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(
  ({ className, title, value, trend, description, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-col gap-1 rounded-xl border border-border-default bg-bg-elevated p-6 shadow-sm',
          className
        )}
        {...props}
      >
        <div className="text-sm font-medium text-text-secondary">{title}</div>
        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-semibold text-text-primary">{value}</div>
          {trend && (
            <div
              className={cn(
                'flex items-center text-sm font-medium',
                trend === 'up' && 'text-success-500',
                trend === 'down' && 'text-error-500',
                trend === 'neutral' && 'text-text-secondary'
              )}
            >
              {trend === 'up' && '↑'}
              {trend === 'down' && '↓'}
              {trend === 'neutral' && '—'}
            </div>
          )}
        </div>
        {description && (
          <div className="text-xs text-text-secondary">{description}</div>
        )}
      </div>
    );
  }
);

StatCard.displayName = 'StatCard';
