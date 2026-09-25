import { Calendar } from 'lucide-react';

import { cn } from '@/lib/utils';

const PRESETS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const;

interface DateRangePickerProps {
  days: number;
  onChange: (days: number) => void;
}

export function DateRangePicker({ days, onChange }: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-2" aria-label="Date range selector">
      <Calendar size={14} className="text-text-tertiary" />
      <div
        className="flex items-center gap-1 rounded-lg border border-border-subtle p-0.5"
      >
        {PRESETS.map((p) => (
          <button
            key={p.days}
            onClick={() => onChange(p.days)}
            className={cn(
              'rounded px-3 py-1 text-xs font-medium transition-colors',
              days === p.days ? 'bg-running text-white' : 'bg-transparent text-text-secondary',
            )}
            aria-pressed={days === p.days}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
