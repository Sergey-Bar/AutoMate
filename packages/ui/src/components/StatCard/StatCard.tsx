import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
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
          className,
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
                trend === 'up' && 'text-success',
                trend === 'down' && 'text-danger',
                trend === 'neutral' && 'text-text-secondary',
              )}
            >
              {/*
                Icons rather than `↑` `↓` `—`.

                `↑` and `↓` are arrows in whatever font resolves them, so the trend
                that matters most on this product rendered at a different weight and
                size on every platform and had no `stroke-width` to bring it in line
                with the row. A lucide icon takes its size and weight from props, so
                it is the same shape at the same weight everywhere.

                All three are `aria-hidden`, and they had to be. They were previously
                read aloud as "up arrow" before the number, so a screen-reader user
                heard the direction twice — once as the glyph and once as whatever
                `value` says — and the glyph carried none of the meaning the colour
                does. `aria-hidden` leaves `value` to speak for itself.
              */}
              {trend === 'up' && <TrendingUp size={16} aria-hidden="true" />}
              {trend === 'down' && <TrendingDown size={16} aria-hidden="true" />}
              {trend === 'neutral' && <Minus size={16} aria-hidden="true" />}
            </div>
          )}
        </div>
        {description && <div className="text-xs text-text-secondary">{description}</div>}
      </div>
    );
  },
);

StatCard.displayName = 'StatCard';
