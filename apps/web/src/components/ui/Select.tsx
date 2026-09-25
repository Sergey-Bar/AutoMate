import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type Size = 'sm' | 'md' | 'lg';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: Size;
  label?: string;
  error?: string;
  hint?: string;
  options: SelectOption[];
  placeholder?: string;
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3 text-sm',
  lg: 'h-11 px-4 text-sm',
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ size = 'md', label, error, hint, options, placeholder, className = '', id, style, ...rest }, ref) => {
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="text-xs font-medium text-text-secondary"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cn(
              'w-full rounded-lg border bg-transparent outline-none appearance-none pr-8 transition-colors duration-150',
              'focus:ring-2 focus:ring-border-focus',
              error ? 'border-error' : 'border-border-default',
              sizeClasses[size],
              'text-text-primary',
              className,
            )}
            style={{
              ...style,
            }}
            {...rest}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-tertiary"
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

Select.displayName = 'Select';
