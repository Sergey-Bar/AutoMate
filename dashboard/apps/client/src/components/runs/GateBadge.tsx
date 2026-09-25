interface GateBadgeProps {
  gateStatus: 'passed' | 'failed' | 'skipped' | null | undefined;
  size?: 'sm' | 'md';
}

export function GateBadge({ gateStatus, size = 'sm' }: GateBadgeProps) {
  if (!gateStatus || gateStatus === 'skipped') return null;
  const cfg = gateStatus === 'passed'
    ? { label: 'Gate: PASS', bg: 'var(--color-pass)', textColor: '#fff' }
    : { label: 'Gate: FAIL', bg: 'var(--color-fail)', textColor: '#fff' };
  const px = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs';
  return (
    <span
      className={`inline-flex items-center rounded font-semibold tracking-wide ${px}`}
      style={{ background: cfg.bg, color: cfg.textColor }}
    >
      {cfg.label}
    </span>
  );
}
