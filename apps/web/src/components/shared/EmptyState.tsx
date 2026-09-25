import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { prefersReducedMotion } from '@/lib/motion';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

// ─── Illustration types ─────────────────────────────────────────────────────

type Illustration = 'radar' | 'inbox' | 'search' | 'chat' | 'shield';

// ─── SVG Illustrations (CSS-animated, oklch-themed) ─────────────────────────

const floatVariants: import('framer-motion').Variants = {
  initial: { y: 0 },
  animate: { y: [-3, 3, -3], transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } },
};

const pulseVariants: import('framer-motion').Variants = {
  initial: { scale: 1, opacity: 0.5 },
  animate: { scale: [1, 1.15, 1], opacity: [0.5, 0.2, 0.5], transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' } },
};
const pulseVariantsDelayed: import('framer-motion').Variants = {
  initial: { scale: 1, opacity: 0.5 },
  animate: { scale: [1, 1.15, 1], opacity: [0.5, 0.2, 0.5], transition: { duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.5 } },
};

const radarVariants: import('framer-motion').Variants = {
  initial: { rotate: 0 },
  animate: { rotate: 360, transition: { duration: 4, repeat: Infinity, ease: 'linear' } },
};

function RadarIllustration() {
  return (
    <div className="relative w-16 h-16">
      {/* Pulse rings */}
      <motion.div
        className={cn('absolute inset-0 rounded-full border-[1.5px] border-primary')}
        style={{ opacity: 0.2 }}
        variants={prefersReducedMotion() ? undefined : pulseVariants}
        initial="initial"
        animate="animate"
      />
      <motion.div
        className={cn('absolute inset-2 rounded-full border-[1.5px] border-primary')}
        style={{ opacity: 0.3 }}
        variants={prefersReducedMotion() ? undefined : pulseVariantsDelayed}
        initial="initial"
        animate="animate"
      />
      {/* Sweep line */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        variants={prefersReducedMotion() ? undefined : radarVariants}
        initial="initial"
        animate="animate"
      >
        <div className="w-px h-1/2 origin-bottom" style={{ background: 'linear-gradient(to top, var(--color-primary), transparent)' }} />
      </motion.div>
      {/* Center dot */}
      <div
        className={cn('absolute top-1/2 left-1/2 w-2 h-2 rounded-full -translate-x-1/2 -translate-y-1/2', 'bg-primary')}
      />
    </div>
  );
}

function InboxIllustration() {
  return (
    <motion.div
      variants={prefersReducedMotion() ? undefined : floatVariants}
      initial="initial"
      animate="animate"
    >
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="12" width="32" height="24" rx="3" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeDasharray="3 2" />
        <path d="M8 28L16 22L24 28L32 22L40 28" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <motion.path
          d="M20 8L24 2L28 8"
          stroke="var(--color-primary)"
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
      variants={prefersReducedMotion() ? undefined : floatVariants}
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
          stroke="var(--color-primary)"
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

function ChatIllustration() {
  return (
    <motion.div
      variants={prefersReducedMotion() ? undefined : floatVariants}
      initial="initial"
      animate="animate"
    >
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Chat bubble */}
        <rect x="6" y="8" width="28" height="20" rx="4" stroke="var(--color-text-tertiary)" strokeWidth="1.5" />
        <path d="M12 28L8 36L18 28" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinejoin="round" />
        {/* Typing dots */}
        <motion.circle
          cx="14"
          cy="18"
          r="2"
          fill="var(--color-primary)"
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 0.2 }}
        />
        <motion.circle
          cx="20"
          cy="18"
          r="2"
          fill="var(--color-primary)"
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: 0.2, repeatDelay: 0.2 }}
        />
        <motion.circle
          cx="26"
          cy="18"
          r="2"
          fill="var(--color-primary)"
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: 0.4, repeatDelay: 0.2 }}
        />
        {/* Second bubble (assistant response) */}
        <rect x="14" y="24" width="28" height="16" rx="4" stroke="var(--color-primary)" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.5" />
      </svg>
    </motion.div>
  );
}

function ShieldIllustration() {
  return (
    <motion.div
      variants={prefersReducedMotion() ? undefined : floatVariants}
      initial="initial"
      animate="animate"
    >
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M24 4L8 12V24C8 34 24 44 24 44C24 44 40 34 40 24V12L24 4Z"
          stroke="var(--color-success)"
          strokeWidth="1.5"
          fill="none"
        />
        <motion.path
          d="M17 24L22 29L31 20"
          stroke="var(--color-success)"
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
  chat: ChatIllustration,
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
 *     illustration="chat"
 *     title="No conversations yet"
 *     description="Start a new chat with Automate to get rolling."
 *     cta="New Chat"
 *     onCta={() => startNewChat()}
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
