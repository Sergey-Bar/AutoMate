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

/** Placeholder for a message list (8 rows × full width) */
export function MessageListSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a conversation list sidebar */
export function ConversationListSkeleton() {
  return (
    <div className="space-y-1.5 p-3">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
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

/** Settings/config page skeleton */
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
