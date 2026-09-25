/**
 * StabilityBadge — Pill badge showing stability letter grade (A+, A, B, C, D, F)
 * Color-coded using CSS custom properties.
 */

interface StabilityBadgeProps {
  grade: string;
  className?: string;
}

const gradeColors: Record<string, string> = {
  'A+': 'var(--color-pass)',
  'A': 'var(--color-pass)',
  'B': 'var(--color-flaky)',
  'C': 'var(--color-warning)',
  'D': 'var(--color-fail)',
  'F': 'var(--color-fail)',
};

const gradeBgColors: Record<string, string> = {
  'A+': 'color-mix(in oklch, var(--color-pass) 15%, transparent)',
  'A': 'color-mix(in oklch, var(--color-pass) 15%, transparent)',
  'B': 'color-mix(in oklch, var(--color-flaky) 15%, transparent)',
  'C': 'color-mix(in oklch, var(--color-warning) 15%, transparent)',
  'D': 'color-mix(in oklch, var(--color-fail) 15%, transparent)',
  'F': 'color-mix(in oklch, var(--color-fail) 15%, transparent)',
};

export function StabilityBadge({ grade, className = '' }: StabilityBadgeProps) {
  if (!grade || grade === '—') return null;

  const color = gradeColors[grade] ?? 'var(--color-text-tertiary)';
  const bg = gradeBgColors[grade] ?? 'var(--color-bg-elevated)';

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular ${className}`}
      style={{ color, background: bg, borderColor: `${color}30`, borderWidth: 1 }}
      title={`Stability: ${grade}`}
    >
      {grade}
    </span>
  );
}
