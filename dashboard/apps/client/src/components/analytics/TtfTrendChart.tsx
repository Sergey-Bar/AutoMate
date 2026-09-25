import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export interface TrendPoint {
  week: string;
  avgTtfMs: number;
  resolvedCount: number;
}

export interface TtfTrendChartProps {
  data: TrendPoint[];
}

function msToHours(ms: number): string {
  const hours = ms / 3600000;
  return `${hours.toFixed(1)}h`;
}

export function TtfTrendChart({ data }: TtfTrendChartProps) {
  if (data.length === 0) {
    return (
      <div
        data-testid="ttf-trend-empty"
        className="flex h-48 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-400"
      >
        No resolution data yet
      </div>
    );
  }

  return (
    <div data-testid="ttf-trend-chart" className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-gray-700">TTF Trend (last 12 weeks)</h2>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={msToHours} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(value: number) => [msToHours(value), 'Avg TTF']} />
          <Line
            type="monotone"
            dataKey="avgTtfMs"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
