import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { GLASS_SURFACE_CLASSES } from '../../tokens/glass.js';
import { cn } from '../../lib/utils.js';

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  value: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  description?: ReactNode;
}

/**
 * A glass panel, and the sharpest version of the question the design language settled.
 *
 * A stat card is a number over whatever the page behind it is showing, and it is often
 * *other numbers*. That is the case `.github/review-rules/rules.json` used to refuse
 * categorically — "the pixels behind a panel in this product are usually the evidence
 * itself" — and it is admissible now because it is measured rather than argued:
 * `theme.test.ts` requires `--automate-text-secondary` to clear 4.5:1 on the composite
 * this fill makes over each of the four plane steps, in both themes.
 *
 * The `text-success` / `text-danger` trend colours are the composer's real risk, because
 * a trend is a claim and it is read at a glance — so they are measured too, not just the
 * body text. `theme.test.ts` holds all five status hues and `--automate-accent` at 4.5:1
 * on the same composite. That is why these two classes are left alone: a hue that has to be
 * raised for glass is raised at the token, where the whole palette's contrast cases live.
 */
export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(
  ({ className, title, value, trend, description, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-col gap-1 rounded-xl border border-border-default p-6',
          GLASS_SURFACE_CLASSES,
          className,
        )}
        {...props}
      >
        <div className="text-sm font-medium text-text-secondary">{title}</div>
        <div className="flex items-baseline gap-2">
          <div className="tabular-nums text-2xl font-semibold text-text-primary">{value}</div>
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
