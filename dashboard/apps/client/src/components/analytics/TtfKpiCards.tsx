export interface TtfKpiCardsProps {
  avgTtfMs: number;
  medianTtfMs: number;
  p95TtfMs: number;
  activeCount: number;
  resolvedCount: number;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0m';
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  'data-testid'?: string;
}

function KpiCard({ title, value, subtitle, 'data-testid': testId }: KpiCardProps) {
  return (
    <div
      data-testid={testId}
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
      {subtitle && <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>}
    </div>
  );
}

export function TtfKpiCards({
  avgTtfMs,
  medianTtfMs,
  p95TtfMs,
  activeCount,
  resolvedCount,
}: TtfKpiCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5" data-testid="ttf-kpi-cards">
      <KpiCard
        data-testid="kpi-avg-ttf"
        title="Avg Time-to-Fix"
        value={formatDuration(avgTtfMs)}
        subtitle="Mean resolution time"
      />
      <KpiCard
        data-testid="kpi-median-ttf"
        title="Median TTF"
        value={formatDuration(medianTtfMs)}
        subtitle="50th percentile"
      />
      <KpiCard
        data-testid="kpi-p95-ttf"
        title="P95 TTF"
        value={formatDuration(p95TtfMs)}
        subtitle="95th percentile"
      />
      <KpiCard
        data-testid="kpi-active"
        title="Active Quarantines"
        value={String(activeCount)}
        subtitle="Tests currently isolated"
      />
      <KpiCard
        data-testid="kpi-resolved"
        title="Resolved Total"
        value={String(resolvedCount)}
        subtitle="Auto-recovered tests"
      />
    </div>
  );
}
