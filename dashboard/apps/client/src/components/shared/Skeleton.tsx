import type React from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Single-line skeleton pulse block with shimmer sweep.
 * Compose multiples to match the layout you're replacing.
 *
 * Usage:
 *   <Skeleton className="h-10 w-full rounded-lg" />
 */
export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div
      className={cn('rounded-md skeleton-shimmer bg-bg-surface', className)}
      style={{ ...style }}
    />
  );
}

// ─── Preset compositions ────────────────────────────────────────────────────

/** Placeholder for a run-list table (8 rows × full width) */
export function RunListSkeleton() {
  return (
    <div className="space-y-1.5 p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** Placeholder for a test-tree list (10 rows with varying widths) */
export function TestListSkeleton() {
  const widths = ['100%', '92%', '85%', '97%', '78%', '100%', '88%', '95%', '82%', '90%'];
  return (
    <div className="space-y-1.5 p-4">
      {widths.map((w, i) => (
        <Skeleton key={i} className="h-11 rounded-lg" style={{ width: w }} />
      ))}
    </div>
  );
}

/** 4 KPI cards */
export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** 2-column chart grid (analytics page) */
export function ChartGridSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className="h-64 w-full rounded-xl" />
      ))}
      <Skeleton className="lg:col-span-2 h-64 w-full rounded-xl" />
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={`pair-${i}`} className="h-64 w-full rounded-xl" />
      ))}
      <Skeleton className="lg:col-span-2 h-64 w-full rounded-xl" />
    </div>
  );
}

/** Split-pane detail layout (test detail, run detail) */
export function DetailPaneSkeleton() {
  return (
    <div className="flex h-full gap-0">
      {/* Left: list */}
      <div className="flex-1 border-r border-border-subtle p-4 space-y-1.5">
        <Skeleton className="h-8 w-48 rounded-lg mb-3" />
        <Skeleton className="h-9 w-full rounded-lg" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full rounded-lg" />
        ))}
      </div>
      {/* Right: detail */}
      <div className="w-[320px] p-4 space-y-3">
        <Skeleton className="h-6 w-32 rounded-md" />
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-3/4 rounded-md" />
        <Skeleton className="h-40 w-full rounded-xl mt-4" />
      </div>
    </div>
  );
}

/** Paragraph text skeleton (varying line widths) */
export function TextSkeleton({ lines = 4 }: { lines?: number }) {
  const widths = ['100%', '95%', '88%', '72%', '93%', '80%', '97%', '65%'];
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3.5 rounded" style={{ width: widths[i % widths.length] }} />
      ))}
    </div>
  );
}

/** Card outline skeleton */
export function CardSkeleton({ count = 1 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border-subtle p-4 space-y-3">
          <Skeleton className="h-4 w-1/3 rounded-md" />
          <Skeleton className="h-3 w-full rounded-md" />
          <Skeleton className="h-3 w-2/3 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** Settings page skeleton */
export function SettingsSkeleton() {
  return (
    <div className="flex h-full gap-0">
      {/* Left nav */}
      <div className="w-52 border-r border-border-subtle p-4 space-y-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-md" />
        ))}
      </div>
      {/* Right content */}
      <div className="flex-1 p-6 space-y-6">
        <Skeleton className="h-6 w-40 rounded-md" />
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-4 w-32 rounded-md" />
              <Skeleton className="h-8 w-24 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
