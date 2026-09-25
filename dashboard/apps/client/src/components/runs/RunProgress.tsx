import { motion } from 'framer-motion';
import { spring } from '@/lib/motion';

interface RunProgressProps {
  passed: number;
  failed: number;
  total: number;
}

export function RunProgress({ passed, failed, total }: RunProgressProps) {
  const progress = total > 0 ? ((passed + failed) / total) * 100 : 0;
  const failPct = total > 0 ? (failed / total) * 100 : 0;

  // Color shifts from blue → amber → red as failure % increases
  const color =
    failPct === 0
      ? 'var(--color-running)'
      : failPct < 5
      ? 'var(--color-flaky)'
      : 'var(--color-fail)';

  return (
    <div
      className="h-1 w-full overflow-hidden shrink-0 bg-bg-elevated"
      role="progressbar"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className="h-full"
        style={{ background: color, transformOrigin: 'left' }}
        animate={{ width: `${progress}%` }}
        transition={spring.smooth}
      />
    </div>
  );
}
