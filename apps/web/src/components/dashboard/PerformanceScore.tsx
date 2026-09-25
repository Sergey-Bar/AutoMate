import React from 'react';
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
      className="inline-flex flex-col items-center gap-1"
      data-testid="performance-score"
      data-color={color}
    >
      <svg width={size} height={size} aria-label={`Performance score: ${clampedScore}`}>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#e8eaed"
          strokeWidth={8}
        />
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
        <span className="text-xs text-text-secondary font-medium">{label}</span>
      )}
    </div>
  );
}
