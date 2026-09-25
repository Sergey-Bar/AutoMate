import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Minus, Zap, Loader2 } from 'lucide-react';
import type { TestStatus, RunStatus } from '@/lib/types';
import { statusColor, statusBgColor, statusLabel } from '@/lib/formatters';
import { safeMotion, statusPassed, statusFailed } from '@/lib/motion';

type BadgeVariant = 'dot' | 'pill' | 'icon';

interface StatusBadgeProps {
  status: TestStatus | RunStatus;
  /** Display variant: dot (default), pill, or icon-only */
  variant?: BadgeVariant;
  /** Show text label next to the dot (default true, ignored for icon variant) */
  showLabel?: boolean;
  /** Size of the dot in px (default 8, only used for dot variant) */
  size?: number;
  className?: string;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  passed:   <Check size={12} />,
  failed:   <X size={12} />,
  timedOut: <X size={12} />,
  flaky:    <Zap size={12} />,
  running:  <Loader2 size={12} className="animate-spin" />,
  skipped:  <Minus size={12} />,
  queued:   <Loader2 size={12} />,
};

export function StatusBadge({
  status,
  variant = 'dot',
  showLabel = true,
  size = 8,
  className = '',
}: StatusBadgeProps) {
  const color = statusColor(status);
  const bg = statusBgColor(status);
  const label = statusLabel(status);
  const isRunning = status === 'running';
  const icon = STATUS_ICONS[status] ?? null;

  if (variant === 'pill') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${className}`}
        style={{ color, background: bg, borderColor: `${color}40` }}
        aria-label={`Status: ${label}`}
      >
        <span className="shrink-0" style={{ color }}>{icon}</span>
        {label}
      </span>
    );
  }

  if (variant === 'icon') {
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 ${className}`}
        style={{ color }}
        title={label}
        aria-label={`Status: ${label}`}
      >
        {icon}
      </span>
    );
  }

  // Default: dot variant
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      aria-label={`Status: ${label}`}
    >
      <Dot size={size} color={color} pulse={isRunning} status={status} />
      {showLabel && (
        <span className="text-[11px] font-medium" style={{ color }}>
          {label}
        </span>
      )}
    </span>
  );
}

function Dot({
  size, color, pulse, status,
}: {
  size: number; color: string; pulse: boolean; status: string;
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={status}
        style={{
          width: size,
          height: size,
          background: color,
          boxShadow: pulse ? `0 0 0 0 ${color}` : undefined,
        }}
        initial="hidden"
        animate="visible"
        variants={
          status === 'passed' ? safeMotion(statusPassed) as never
          : status === 'failed' || status === 'timedOut' ? safeMotion(statusFailed) as never
          : {}
        }
        className={`${pulse ? 'pulse-ring' : ''} shrink-0 rounded-full inline-block`.trim()}
      />
    </AnimatePresence>
  );
}

/** Pill-style badge for run-level status (slightly larger) */
export function RunStatusBadge({ status, compact = false }: { status: RunStatus; compact?: boolean }) {
  const color = statusColor(status);
  const label = statusLabel(status);

  if (compact) {
    return (
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: color }}
        title={label}
      />
    );
  }

  return (
    <StatusBadge status={status} variant="pill" />
  );
}
