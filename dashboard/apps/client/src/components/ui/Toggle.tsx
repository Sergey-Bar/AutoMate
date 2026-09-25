import { motion } from 'framer-motion';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';


interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  id?: string;
}

const sizes = {
  sm: { track: 'w-7 h-4', thumb: 'w-3 h-3', translate: 12 },
  md: { track: 'w-9 h-5', thumb: 'w-3.5 h-3.5', translate: 16 },
} as const;

export function Toggle({ checked, onChange, label, size = 'md', disabled, id }: ToggleProps) {
  const s = sizes[size];
  const toggleId = id || (label ? `toggle-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

  return (
    <label
      htmlFor={toggleId}
      className={cn(
        'inline-flex items-center gap-2',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      <button
        id={toggleId}
        role="switch"
        type="button"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (!disabled) onChange(!checked);
          }
        }}
        className={cn(
          'relative rounded-full transition-colors duration-150 shrink-0',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          checked
            ? 'bg-running border-running'
            : 'bg-bg-surface border-border-default',
          'border',
          s.track,
        )}
      >
        <motion.span
          layout
          transition={spring.snappy}
          className={`block rounded-full absolute top-1/2 ${s.thumb}`}
          style={{
            background: '#fff',
            transform: `translateY(-50%)`,
            left: checked ? `${s.translate}px` : '2px',
          }}
        />
      </button>
      {label && (
        <span className="text-sm text-text-secondary">
          {label}
        </span>
      )}
    </label>
  );
}
