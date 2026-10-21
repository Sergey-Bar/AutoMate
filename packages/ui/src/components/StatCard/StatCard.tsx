import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  value: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  description?: ReactNode;
}

const TREND = {
  up: { Icon: TrendingUp, tone: 'text-success', label: 'Trending up' },
  down: { Icon: TrendingDown, tone: 'text-danger', label: 'Trending down' },
  neutral: { Icon: Minus, tone: 'text-fg-muted', label: 'No change' },
} as const;

/**
 * One number, read at a glance.
 *
 * A flat panel with an uppercase eyebrow, a display-size figure in tabular numerals, and
 * the trend as an icon plus a screen-reader label. The colour is never the only carrier:
 * `text-success` on its own tells a reader with a colour-vision deficiency nothing.
 */
export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(
  ({ className, title, value, trend, description, ...props }, ref) => {
    const shown = trend ? TREND[trend] : undefined;
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-col gap-2 rounded-xl border border-border bg-surface p-5',
          className,
        )}
        {...props}
      >
        <div className="text-xs font-medium uppercase tracking-wider text-fg-muted">{title}</div>
        <div className="flex items-baseline gap-2">
          <div className="text-3xl font-semibold tracking-tight tabular-nums text-fg">{value}</div>
          {shown && (
            <div className={cn('flex items-center', shown.tone)}>
              <shown.Icon size={16} aria-hidden="true" />
              <span className="sr-only">{shown.label}</span>
            </div>
          )}
        </div>
        {description && <div className="text-xs text-fg-muted">{description}</div>}
      </div>
    );
  },
);

StatCard.displayName = 'StatCard';
