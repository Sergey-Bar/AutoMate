import { forwardRef, type InputHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const toggleVariants = cva(
  'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'data-[state=checked]:bg-primary data-[state=unchecked]:bg-bg-elevated',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export { toggleVariants };

const thumbVariants = cva(
  'pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform',
  {
    variants: {
      checked: {
        true: 'translate-x-5',
        false: 'translate-x-0',
      },
    },
    defaultVariants: {
      checked: false,
    },
  },
);

export type ToggleVariants = VariantProps<typeof toggleVariants>;

export interface ToggleProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>, ToggleVariants {
  label?: string;
  'data-testid'?: string;
}

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(
  (
    { className, variant: _variant, label, id, 'data-testid': testId, checked, disabled, ...props },
    ref,
  ) => {
    return (
      <div className="flex items-center gap-3">
        <label
          htmlFor={id}
          className={cn(
            'relative inline-flex items-center',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
        >
          <input
            type="checkbox"
            id={id}
            ref={ref}
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            checked={checked}
            data-testid={testId}
            className="sr-only peer"
            {...props}
          />
          <div
            className={cn(
              'h-6 w-11 rounded-full border-2 border-transparent transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-border-focus',
              'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
              checked ? 'bg-primary' : 'bg-bg-elevated',
              className,
            )}
            aria-hidden="true"
          >
            <span className={cn(thumbVariants({ checked: !!checked }))} />
          </div>
        </label>
        {label && (
          <label
            htmlFor={id}
            className={cn(
              'text-sm font-medium',
              disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer text-text-primary',
            )}
          >
            {label}
          </label>
        )}
      </div>
    );
  },
);

Toggle.displayName = 'Toggle';
