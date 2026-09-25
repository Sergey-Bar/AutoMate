/**
 * CIStatusBadge.tsx — Display GitHub Actions / CI status for a commit
 */
import { useQuery } from '@tanstack/react-query';

interface CIStatusResult {
  provider: string | null;
  status: string;
  url: string | null;
  runId?: string;
}

interface CIStatusBadgeProps {
  commitSha?: string | null;
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  success: {
    bg: 'var(--color-pass)',
    color: '#fff',
    label: 'CI: Passed',
  },
  failure: {
    bg: 'var(--color-fail)',
    color: '#fff',
    label: 'CI: Failed',
  },
  in_progress: {
    bg: 'var(--color-running)',
    color: '#fff',
    label: 'CI: Running',
  },
  queued: {
    bg: 'var(--color-running)',
    color: '#fff',
    label: 'CI: Queued',
  },
  cancelled: {
    bg: 'var(--color-text-tertiary)',
    color: '#fff',
    label: 'CI: Cancelled',
  },
  timed_out: {
    bg: 'var(--color-fail)',
    color: '#fff',
    label: 'CI: Timed Out',
  },
};

const DEFAULT_STYLE = {
  bg: 'var(--color-text-tertiary)',
  color: '#fff',
  label: 'CI: Unknown',
};

export function CIStatusBadge({ commitSha }: CIStatusBadgeProps) {
  const { data, isLoading } = useQuery<CIStatusResult>({
    queryKey: ['ci-status', commitSha],
    queryFn: async () => {
      const res = await fetch(`/api/ci/status?sha=${commitSha}`);
      if (!res.ok) throw new Error('Failed to fetch CI status');
      return res.json();
    },
    enabled: !!commitSha,
    refetchInterval: 30_000, // Poll every 30s
    staleTime: 15_000,
  });

  if (!commitSha || isLoading || !data || !data.provider) return null;

  const style = STATUS_STYLES[data.status] ?? DEFAULT_STYLE;

  const handleClick = () => {
    if (data.url) {
      window.open(data.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={!data.url}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        fontSize: 'var(--font-size-xs, 11px)',
        fontWeight: 600,
        letterSpacing: '0.025em',
        background: style.bg,
        color: style.color,
        border: 'none',
        borderRadius: 'var(--radius-sm, 4px)',
        cursor: data.url ? 'pointer' : 'default',
        textDecoration: 'none',
        lineHeight: 1.4,
      }}
      title={data.url ? `Open ${data.provider} CI run` : undefined}
    >
      {style.label}
      {data.url && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="M3.5 1.5h7v7" />
          <path d="M10.5 1.5l-9 9" />
        </svg>
      )}
    </button>
  );
}
