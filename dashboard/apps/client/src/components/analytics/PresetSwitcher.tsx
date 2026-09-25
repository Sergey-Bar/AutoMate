import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ANALYTICS_PRESETS, type AnalyticsPreset } from '@/lib/analytics-presets';
import { cn } from '@/lib/utils';

async function fetchFeatures(): Promise<{ 'role-based-views': boolean }> {
  const res = await fetch('/api/features');
  if (!res.ok) {
    throw new Error('Failed to fetch feature flags');
  }
  return res.json();
}

interface PresetSwitcherProps {
  currentPreset: AnalyticsPreset;
}

export function PresetSwitcher({ currentPreset }: PresetSwitcherProps) {
  const navigate = useNavigate({ from: '/analytics/' });
  const { data: features, isLoading, isError } = useQuery({
    queryKey: ['features'],
    queryFn: fetchFeatures,
  });

  const setPreset = (preset: AnalyticsPreset) => {
    navigate({ search: (prev) => ({ ...prev, preset }) });
    localStorage.setItem('analytics-preset', preset);
  };

  if (isLoading || isError || !features?.['role-based-views']) {
    return null;
  }

  return (
    <div className="flex items-center space-x-2 rounded-lg bg-bg-surface p-1">
      {(Object.keys(ANALYTICS_PRESETS) as AnalyticsPreset[]).map((preset) => (
        <button
          key={preset}
          onClick={() => setPreset(preset)}
          className={cn(
            'px-3 py-1 text-sm font-medium rounded-md transition-colors',
            currentPreset === preset
              ? 'bg-bg-primary text-text-on-primary'
              : 'text-text-secondary hover:bg-bg-hover'
          )}
          title={ANALYTICS_PRESETS[preset].description}
        >
          {ANALYTICS_PRESETS[preset].label}
        </button>
      ))}
    </div>
  );
}
