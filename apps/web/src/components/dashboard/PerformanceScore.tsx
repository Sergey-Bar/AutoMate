import { getScoreColor } from '../../services/performance-budget.js';

interface PerformanceScoreProps {
  score: number;
  label?: string;
  size?: number;
}

const COLOR_MAP = {
  green: '#0cce6b',
  yellow: '#ffa400',
  red: '#ff4e42',
} as const;

export function PerformanceScore({ score, label, size = 120 }: PerformanceScoreProps) {
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const color = getScoreColor(clampedScore);
  const hex = COLOR_MAP[color];

  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clampedScore / 100) * circumference;
  const center = size / 2;

  return (
    <div
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
      data-testid="performance-score"
      data-color={color}
    >
      <svg width={size} height={size} aria-label={`Performance score: ${clampedScore}`}>
        {/* Background track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#e8eaed"
          strokeWidth={8}
        />
        {/* Score arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={hex}
          strokeWidth={8}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
          data-testid="score-arc"
        />
        {/* Score text */}
        <text
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.22}
          fontWeight="bold"
          fill={hex}
          data-testid="score-text"
        >
          {clampedScore}
        </text>
      </svg>
      {label && (
        <span style={{ fontSize: 12, color: '#5f6368', fontWeight: 500 }}>{label}</span>
      )}
    </div>
  );
}
