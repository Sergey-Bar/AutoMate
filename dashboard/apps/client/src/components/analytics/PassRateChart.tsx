import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export interface PassRatePoint {
  date: string;
  [project: string]: number | string;
}

interface PassRateChartProps {
  data: PassRatePoint[];
  projects: string[];
}

const COLORS = [
  'var(--color-pass)',
  '#6366f1',
  '#f59e0b',
  '#06b6d4',
  '#f43f5e',
  '#84cc16',
];

export function PassRateChart({ data, projects }: PassRateChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <defs>
          {projects.map((p, i) => (
            <linearGradient key={p} id={`pr-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.3} />
              <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
        <XAxis
          dataKey="date"
          tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => `${v}%`}
          tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          domain={[0, 100]}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 8,
            fontSize: 11,
          }}
          formatter={(v: number) => [`${v.toFixed(1)}%`]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {projects.map((p, i) => (
          <Area
            key={p}
            type="monotone"
            dataKey={p}
            stroke={COLORS[i % COLORS.length]}
            fill={`url(#pr-${i})`}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
