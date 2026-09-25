import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';

export interface DurationPoint {
  date: string;
  p50: number;
  p95: number;
}

interface DurationChartProps {
  data: DurationPoint[];
}

export function DurationChart({ data }: DurationChartProps) {
  // Simple linear regression on p95 to draw trend line
  const n = data.length;
  let trend: number | undefined;
  if (n >= 2) {
    const xs = data.map((_, i) => i);
    const ys = data.map((d) => d.p95);
    const xMean = xs.reduce((a, b) => a + b, 0) / n;
    const yMean = ys.reduce((a, b) => a + b, 0) / n;
    const slope =
      xs.reduce((sum, x, i) => sum + (x - xMean) * ((ys[i] ?? 0) - yMean), 0) /
      xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
    trend = yMean + slope * (n - 1);
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="dur-p50" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-pass)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--color-pass)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="dur-p95" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
        <XAxis
          dataKey="date"
          tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}s`}
          tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 8,
            fontSize: 11,
          }}
          formatter={(v: number) => [`${(v / 1000).toFixed(2)}s`]}
        />
        {trend !== undefined && (
          <ReferenceLine
            y={trend}
            stroke="#f59e0b"
            strokeDasharray="4 4"
            label={{ value: 'p95 trend', position: 'insideTopRight', fontSize: 10, fill: '#f59e0b' }}
          />
        )}
        <Area
          type="monotone"
          dataKey="p50"
          name="p50"
          stroke="var(--color-pass)"
          fill="url(#dur-p50)"
          strokeWidth={2}
          dot={false}
        />
        <Area
          type="monotone"
          dataKey="p95"
          name="p95"
          stroke="#f59e0b"
          fill="url(#dur-p95)"
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
