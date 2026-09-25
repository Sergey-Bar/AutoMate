import { useState, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
  delay?: number;
}

export function Tooltip({ content, children, side = 'top', delay = 300 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = () => {
    timerRef.current = setTimeout(() => setOpen(true), delay);
  };

  const hide = () => {
    clearTimeout(timerRef.current);
    setOpen(false);
  };

  const isTop = side === 'top';

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, y: isTop ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: isTop ? 4 : -4 }}
            transition={{ duration: 0.1 }}
            role="tooltip"
            className={cn(
              'absolute left-1/2 -translate-x-1/2 z-50 pointer-events-none',
              'px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap',
              'bg-bg-elevated text-text-primary border border-border-default',
              isTop ? 'bottom-full mb-2' : 'top-full mt-2',
            )}
            style={{
              boxShadow: '0 4px 12px oklch(0 0 0 / 0.15)',
            }}
          >
            {content}
            {/* Arrow */}
            <span
              className={cn(
                'absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45',
                'bg-bg-elevated',
                isTop ? 'border-r border-b border-border-default' : 'border-l border-t border-border-default',
                isTop ? 'top-full -mt-1' : 'bottom-full -mb-1',
              )}
            />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
