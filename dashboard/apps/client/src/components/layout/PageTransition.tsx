import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { safeMotion } from '@/lib/motion';

const variants = safeMotion({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.15, ease: [0.25, 0.1, 0.25, 1] } },
});

interface PageTransitionProps {
  children: ReactNode;
  /** Unique key for route — typically the route pathname */
  routeKey?: string;
}

/** Wrap route content for a subtle fade+slide-up enter animation. No exit (instant removal). */
export function PageTransition({ children, routeKey }: PageTransitionProps) {
  return (
    <motion.div key={routeKey} {...variants}>
      {children}
    </motion.div>
  );
}
