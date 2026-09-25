import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FeatureDisabledPageProps {
  feature: string;
}

/**
 * Full-page fallback shown when a user navigates to a route
 * whose feature flag is currently disabled.
 */
export function FeatureDisabledPage({ feature }: FeatureDisabledPageProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 h-full px-6 py-20 text-center">
      <div
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-full',
          'text-text-tertiary',
        )}
        style={{ background: 'oklch(0.68 0.19 250 / 8%)' }}
      >
        <Lock size={24} />
      </div>

      <div>
        <p className="text-sm font-semibold text-text-primary">
          {feature} is not enabled
        </p>
        <p className={cn('mt-1 max-w-sm text-xs leading-relaxed', 'text-text-secondary')}>
          This feature is currently disabled. Contact your administrator or enable the feature flag in Settings to access this page.
        </p>
      </div>
    </div>
  );
}
