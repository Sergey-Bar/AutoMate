interface SourceBadgeProps {
  source: 'live' | 'blob' | null | undefined;
}

export function SourceBadge({ source }: SourceBadgeProps) {
  if (!source || source === 'live') return null;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-surface-3 text-text-secondary border border-border-default"
    >
      BLOB
    </span>
  );
}
