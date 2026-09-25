import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

export interface SlowTest {
  title: string;
  file: string;
  avgDurationMs: number;
  p95DurationMs: number;
}

interface SlowestTestsProps {
  data: SlowTest[];
}

export function SlowestTests({ data }: SlowestTestsProps) {
  const top20 = data.slice(0, 20).map((d) => ({
    ...d,
    label: d.title.length > 20 ? d.title.slice(0, 18) + '…' : d.title,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, top20.length * 24)}>
      <BarChart
        layout="vertical"
        data={top20}
        margin={{ top: 4, right: 40, left: 4, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v) => `${(v / 1000).toFixed(1)}s`}
          tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={140}
          tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }}
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
          formatter={(v: number, name) => [`${(v / 1000).toFixed(2)}s`, name === 'avgDurationMs' ? 'avg' : 'p95']}
          labelFormatter={(_, payload) => (payload as Array<{ payload?: { title?: string } }>)?.[0]?.payload?.title ?? ''}
        />
        <Bar dataKey="avgDurationMs" name="avg" radius={[0, 4, 4, 0]} barSize={8}>
          {top20.map((item) => (
            <Cell key={`${item.file}-${item.title}-avg`} fill="var(--color-pass)" />
          ))}
        </Bar>
        <Bar dataKey="p95DurationMs" name="p95" radius={[0, 4, 4, 0]} barSize={8}>
          {top20.map((item) => (
            <Cell key={`${item.file}-${item.title}-p95`} fill="#f59e0b" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
