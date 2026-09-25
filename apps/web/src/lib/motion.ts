/**
 * motion.ts — Framer Motion preset catalog
 *
 * All page code should import from here so animation values stay consistent.
 */
import type { Transition, Variants } from 'framer-motion';

// ─── Spring presets ────────────────────────────────────────────────────────
export const spring = {
  /** Buttons, badges, status changes — very snappy */
  snappy: { type: 'spring', stiffness: 500, damping: 35 } satisfies Transition,
  /** Drawer open, panel slide-in — smooth */
  smooth: { type: 'spring', stiffness: 280, damping: 28 } satisfies Transition,
  /** Chart draw-on, page intro — slow and cinematic */
  slow:   { type: 'spring', stiffness: 160, damping: 26 } satisfies Transition,
} as const;

// ─── Ease presets ─────────────────────────────────────────────────────────
export const ease = {
  /** Hover bg — Linear-speed (60ms) */
  fast:     { duration: 0.06, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } satisfies Transition,
  /** Popovers, tooltips */
  standard: { duration: 0.15, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } satisfies Transition,
} as const;

// ─── Stagger ──────────────────────────────────────────────────────────────
export const stagger = {
  /** Animated list items */
  list: { delayChildren: 0.02, staggerChildren: 0.04 },
} as const;

// ─── Common variants ──────────────────────────────────────────────────────

/** Fade + slide up — test tree rows, list items */
export const fadeSlideUp: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: spring.snappy },
};

/** Detail panel slide in from right */
export const panelSlideIn: Variants = {
  hidden:  { x: 20, opacity: 0 },
  visible: { x: 0,  opacity: 1, transition: spring.smooth },
  exit:    { x: 20, opacity: 0, transition: spring.smooth },
};

/** Command palette scale + fade */
export const commandPalette: Variants = {
  hidden:  { scale: 0.96, opacity: 0 },
  visible: { scale: 1,    opacity: 1, transition: ease.standard },
  exit:    { scale: 0.96, opacity: 0, transition: ease.standard },
};

/** Status transition — spinner → ✓ (passed) */
export const statusPassed: Variants = {
  hidden:  { scale: 0.6, opacity: 0 },
  visible: { scale: [0.6, 1.2, 1.0], opacity: 1, transition: spring.snappy },
};

/** Status transition — spinner → ✗ with shake (failed) */
export const statusFailed: Variants = {
  hidden:  { scale: 0.6, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    rotate: [-3, 3, -2, 2, 0],
    transition: spring.snappy,
  },
};

/** Live counter digit flip */
export const counterFlip: Variants = {
  hidden:  { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: spring.snappy },
  exit:    { opacity: 0, y: -10, transition: { duration: 0.08 } },
};

/** Message bubble animation */
export const messageBubble: Variants = {
  hidden:  { opacity: 0, y: 10, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: spring.smooth },
};

/** Tool card expand animation */
export const toolCardExpand: Variants = {
  hidden:  { opacity: 0, height: 0 },
  visible: { opacity: 1, height: 'auto', transition: spring.smooth },
  exit:    { opacity: 0, height: 0, transition: { duration: 0.15 } },
};

// ─── Reduced Motion Utilities ─────────────────────────────────────────────

/**
 * Check if reduced motion is enabled.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Returns the variant if motion is allowed, or undefined for reduced motion.
 * Use with explicit initial/animate states.
 *
 * @example
 * <motion.div
 *   variants={reducedMotionSafe(fadeSlideUp)}
 *   initial="hidden"
 *   animate="visible"
 * />
 */
export function reducedMotionSafe<T extends Variants>(variants: T): T | undefined {
  if (prefersReducedMotion()) return undefined;
  return variants;
}

/**
 * @deprecated Use direct variants or reducedMotionSafe() for type-safe usage.
 * This wrapper remains for Dashboard compat but casts to avoid TS issues.
 */
export function safeMotion<T extends Variants>(variant: T): T {
  if (prefersReducedMotion()) {
    // Return empty object cast as T to satisfy Framer Motion
    return {} as unknown as T;
  }
  return variant;
}
