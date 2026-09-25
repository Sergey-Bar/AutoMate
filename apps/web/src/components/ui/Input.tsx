import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Size = 'sm' | 'md' | 'lg';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: Size;
  label?: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3 text-sm',
  lg: 'h-11 px-4 text-sm',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ size = 'md', label, error, hint, icon, className = '', id, style, ...rest }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-medium text-text-secondary"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <span
              className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-tertiary"
            >
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full rounded-lg border bg-transparent outline-none transition-colors duration-150',
              'focus:ring-2 focus:ring-border-focus',
              error ? 'border-error' : 'border-border-default',
              sizeClasses[size],
              icon ? 'pl-8' : '',
              'text-text-primary',
              className,
            )}
            style={{
              ...style,
            }}
            {...rest}
          />
        </div>
        {error && (
          <p className="text-[11px] text-error">
            {error}
          </p>
        )}
        {hint && !error && (
          <p className="text-[11px] text-text-tertiary">
            {hint}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
