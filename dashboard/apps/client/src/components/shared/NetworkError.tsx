import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { safeMotion } from '@/lib/motion';
import { Button } from '@/components/ui/Button';
import { WifiOff, RefreshCw } from 'lucide-react';

const floatVariants = {
  initial: { y: 0 },
  animate: { y: [-3, 3, -3], transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } },
};

interface NetworkErrorProps {
  /** Optional message override */
  message?: string;
  /** Callback when retry succeeds or is triggered manually */
  onRetry?: () => void;
}

/**
 * Network error state with animated icon and auto-retry countdown.
 * Shows exponential backoff timer (3s, 6s, 12s, 24s, max 30s).
 */
export function NetworkError({ message, onRetry }: NetworkErrorProps) {
  const [attempt, setAttempt] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const maxAttempts = 5;

  const getDelay = useCallback((n: number) => Math.min(3 * Math.pow(2, n), 30), []);

  // Auto-retry countdown
  useEffect(() => {
    if (attempt >= maxAttempts) return;
    const delay = getDelay(attempt);
    setCountdown(delay);

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setAttempt((a) => a + 1);
          onRetry?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [attempt, getDelay, onRetry, maxAttempts]);

  const handleManualRetry = () => {
    setAttempt(0);
    onRetry?.();
  };

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle p-8 text-center"
      style={{ minHeight: 200 }}
    >
      {/* Animated icon */}
      <motion.div
        variants={safeMotion(floatVariants) as typeof floatVariants}
        initial="initial"
        animate="animate"
      >
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full text-warning"
          style={{ background: 'oklch(0.55 0.15 30 / 12%)' }}
        >
          <WifiOff size={28} />
        </div>
      </motion.div>

      {/* Message */}
      <div>
        <p className="text-sm font-semibold text-text-primary">
          Can't reach the server
        </p>
        <p className="mt-1 max-w-sm text-xs text-text-secondary">
          {message || 'The dashboard server is not responding. Check that the server is running and try again.'}
        </p>
      </div>

      {/* Countdown / retry */}
      {attempt < maxAttempts ? (
        <div className="flex items-center gap-3">
          <p className="text-xs tabular text-text-tertiary">
            Retrying in {countdown}s…
          </p>
          <Button variant="secondary" size="sm" icon={<RefreshCw size={12} />} onClick={handleManualRetry}>
            Retry Now
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-text-tertiary">
            Auto-retry stopped after {maxAttempts} attempts.
          </p>
          <Button variant="primary" size="sm" icon={<RefreshCw size={12} />} onClick={handleManualRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
