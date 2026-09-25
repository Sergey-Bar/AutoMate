import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { Radar, Home, ArrowLeft, TestTube2, TrendingUp, Settings } from 'lucide-react';
import { spring, ease, safeMotion } from '@/lib/motion';

const floatVariants = {
  initial: { y: 0 },
  animate: {
    y: [-4, 4, -4],
    transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
  },
};

const quickLinks = [
  { label: 'Dashboard', to: '/', icon: Home },
  { label: 'Test Explorer', to: '/tests', icon: TestTube2 },
  { label: 'Analytics', to: '/analytics', icon: TrendingUp },
  { label: 'Settings', to: '/settings', icon: Settings },
] as const;

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
      {/* Animated radar icon */}
      <motion.div
        variants={safeMotion(floatVariants) as typeof floatVariants}
        initial="initial"
        animate="animate"
        className="mb-8"
      >
        <div
          className="w-24 h-24 rounded-2xl flex items-center justify-center"
          style={{ background: 'oklch(0.68 0.19 250 / 10%)' }}
        >
          <Radar size={48} className="text-running" />
        </div>
      </motion.div>

      {/* 404 heading */}
      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring.smooth}
        className="text-6xl font-bold tabular mb-2 text-text-primary"
      >
        404
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.smooth, delay: 0.05 }}
        className="text-lg mb-1 text-text-secondary"
      >
        Page not found
      </motion.p>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...ease.standard, delay: 0.1 }}
        className="text-sm mb-8 text-center max-w-sm text-text-tertiary"
      >
        The page you're looking for doesn't exist or has been moved.
      </motion.p>

      {/* Action buttons */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.smooth, delay: 0.15 }}
        className="flex items-center gap-3 mb-10"
      >
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-border-default text-text-secondary transition-colors hover:bg-white/5"
        >
          <ArrowLeft size={14} />
          Go Back
        </button>
        <Link
          to="/"
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-running text-white transition-colors"
        >
          <Home size={14} />
          Dashboard
        </Link>
      </motion.div>

      {/* Quick links */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...ease.standard, delay: 0.2 }}
        className="flex flex-wrap items-center justify-center gap-2"
      >
        <span className="text-xs mr-1 text-text-tertiary">
          Quick links:
        </span>
        {quickLinks.map(({ label, to, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border-subtle text-text-secondary transition-colors hover:bg-white/5"
          >
            <Icon size={12} />
            {label}
          </Link>
        ))}
      </motion.div>
    </div>
  );
}
