import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { safeMotion } from '@/lib/motion';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

// ─── Illustration types ─────────────────────────────────────────────────────

type Illustration = 'radar' | 'inbox' | 'search' | 'chart' | 'grid' | 'shield';

// ─── SVG Illustrations (CSS-animated, oklch-themed) ─────────────────────────

const radarVariants = {
  initial: { rotate: 0 },
  animate: { rotate: 360, transition: { duration: 4, repeat: Infinity, ease: 'linear' } },
};

const floatVariants = {
  initial: { y: 0 },
  animate: { y: [-3, 3, -3], transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } },
};

const pulseVariants = {
  initial: { scale: 1, opacity: 0.5 },
  animate: { scale: [1, 1.15, 1], opacity: [0.5, 0.2, 0.5], transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' } },
};

function RadarIllustration() {
  return (
    <div className="relative w-16 h-16">
      {/* Pulse rings */}
      <motion.div
        className={cn('absolute inset-0 rounded-full border-[1.5px] border-running')}
        style={{ opacity: 0.2 }}
        variants={safeMotion(pulseVariants) as typeof pulseVariants}
        initial="initial"
        animate="animate"
      />
      <motion.div
        className={cn('absolute inset-2 rounded-full border-[1.5px] border-running')}
        style={{ opacity: 0.3 }}
        variants={safeMotion({ ...pulseVariants, animate: { ...pulseVariants.animate, transition: { ...pulseVariants.animate.transition, delay: 0.5 } } }) as typeof pulseVariants}
        initial="initial"
        animate="animate"
      />
      {/* Sweep line */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        variants={safeMotion(radarVariants) as typeof radarVariants}
        initial="initial"
        animate="animate"
      >
        <div className="w-px h-1/2 origin-bottom" style={{ background: 'linear-gradient(to top, var(--color-running), transparent)' }} />
      </motion.div>
      {/* Center dot */}
      <div
        className={cn('absolute top-1/2 left-1/2 w-2 h-2 rounded-full -translate-x-1/2 -translate-y-1/2', 'bg-running')}
      />
    </div>
  );
}

function InboxIllustration() {
  return (
    <motion.div
      variants={safeMotion(floatVariants) as typeof floatVariants}
      initial="initial"
      animate="animate"
    >
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="12" width="32" height="24" rx="3" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeDasharray="3 2" />
        <path d="M8 28L16 22L24 28L32 22L40 28" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <motion.path
          d="M20 8L24 2L28 8"
          stroke="var(--color-running)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: [0, 1, 0], y: [4, 0, -4] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      </svg>
    </motion.div>
  );
}

function SearchIllustration() {
  return (
    <motion.div
      variants={safeMotion(floatVariants) as typeof floatVariants}
      initial="initial"
      animate="animate"
    >
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="22" cy="22" r="10" stroke="var(--color-text-tertiary)" strokeWidth="1.5" />
        <line x1="29.07" y1="29.07" x2="38" y2="38" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" />
        {/* Animated highlight sweep */}
        <motion.circle
          cx="22"
          cy="22"
          r="10"
          stroke="var(--color-running)"
          strokeWidth="1.5"
          strokeDasharray="62.83"
          strokeDashoffset="62.83"
          strokeLinecap="round"
          animate={{ strokeDashoffset: [62.83, 0, 62.83] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
      </svg>
    </motion.div>
  );
}

function ChartIllustration() {
  const barHeights = [12, 20, 16, 28, 22, 32, 18];
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {barHeights.map((h, i) => (
        <motion.rect
          key={i}
          x={6 + i * 5.5}
          y={40 - h}
          width="4"
          height={h}
          rx="1"
          fill="var(--color-text-tertiary)"
          initial={{ scaleY: 0, opacity: 0.3 }}
          animate={{ scaleY: 1, opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.1 }}
          style={{ transformOrigin: `${8 + i * 5.5}px 40px` }}
        />
      ))}
      {/* Baseline */}
      <line x1="4" y1="40" x2="44" y2="40" stroke="var(--color-border-subtle)" strokeWidth="1" />
    </svg>
  );
}

function GridIllustration() {
  return (
    <motion.div
      variants={safeMotion(floatVariants) as typeof floatVariants}
      initial="initial"
      animate="animate"
    >
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* 2x2 grid of screenshot placeholders */}
        <rect x="4" y="4" width="18" height="14" rx="2" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeDasharray="3 2" />
        <rect x="26" y="4" width="18" height="14" rx="2" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeDasharray="3 2" />
        <rect x="4" y="22" width="18" height="14" rx="2" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeDasharray="3 2" />
        <rect x="26" y="22" width="18" height="14" rx="2" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeDasharray="3 2" />
        {/* Mountain icon in first placeholder */}
        <path d="M8 14L12 9L16 14" stroke="var(--color-text-tertiary)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
        {/* Checkmark in third placeholder */}
        <motion.path
          d="M10 29L13 32L18 26"
          stroke="var(--color-pass)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 2, ease: 'easeInOut' }}
        />
      </svg>
    </motion.div>
  );
}

function ShieldIllustration() {
  return (
    <motion.div
      variants={safeMotion(floatVariants) as typeof floatVariants}
      initial="initial"
      animate="animate"
    >
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M24 4L8 12V24C8 34 24 44 24 44C24 44 40 34 40 24V12L24 4Z"
          stroke="var(--color-pass)"
          strokeWidth="1.5"
          fill="none"
        />
        <motion.path
          d="M17 24L22 29L31 20"
          stroke="var(--color-pass)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1, repeat: Infinity, repeatDelay: 3, ease: 'easeOut' }}
        />
      </svg>
    </motion.div>
  );
}

const illustrationMap: Record<Illustration, () => ReactNode> = {
  radar: RadarIllustration,
  inbox: InboxIllustration,
  search: SearchIllustration,
  chart: ChartIllustration,
  grid: GridIllustration,
  shield: ShieldIllustration,
};

// ─── EmptyState component ───────────────────────────────────────────────────

interface EmptyStateProps {
  /** Primary heading */
  title: string;
  /** Supporting description text */
  description?: string;
  /** Icon / illustration node rendered above the title (legacy) */
  icon?: ReactNode;
  /** Named illustration — takes priority over icon prop */
  illustration?: Illustration;
  /** CTA button label — omit to hide the button */
  cta?: string;
  onCta?: () => void;
}

/**
 * Reusable empty-state panel used across all data views.
 *
 * Usage:
 *   <EmptyState
 *     illustration="radar"
 *     title="No test runs yet"
 *     description="Trigger your first run to populate this dashboard."
 *     cta="New Run"
 *     onCta={() => setTriggerOpen(true)}
 *   />
 */
export function EmptyState({ title, description, icon, illustration, cta, onCta }: EmptyStateProps) {
  const IllustrationComponent = illustration ? illustrationMap[illustration] : null;

  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-3 rounded-xl border px-6 py-14 text-center', 'border-border-subtle')}
    >
      {IllustrationComponent ? (
        <div className="mb-1">
          <IllustrationComponent />
        </div>
      ) : icon ? (
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full text-text-tertiary"
          style={{
            background: 'oklch(0.68 0.19 250 / 8%)',
          }}
        >
          {icon}
        </div>
      ) : null}

      <div>
        <p className="text-sm font-semibold text-text-primary">
          {title}
        </p>
        {description && (
          <p
            className={cn('mt-1 max-w-xs text-xs leading-relaxed', 'text-text-secondary')}
          >
            {description}
          </p>
        )}
      </div>

      {cta && onCta && (
        <Button
          variant="primary"
          size="sm"
          onClick={onCta}
          className="mt-1"
        >
          {cta}
        </Button>
      )}
    </div>
  );
}
