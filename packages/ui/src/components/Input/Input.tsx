import { forwardRef, type InputHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const inputVariants = cva(
  'flex w-full rounded-lg border bg-transparent transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border-border-default text-text-primary',
        error: 'border-error text-error focus-visible:outline-error',
      },
      size: {
        sm: 'h-8 px-2.5 text-xs',
        md: 'h-10 px-3.5 text-sm',
        lg: 'h-12 px-5 text-base',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

export type InputVariants = VariantProps<typeof inputVariants>;

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, InputVariants {
  label?: string;
  error?: string;
  helperText?: string;
  'data-testid'?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant, size, label, error, helperText, id, 'data-testid': testId, disabled, ...props }, ref) => {
    // Force variant to error if error prop is present
    const inputVariant = error ? 'error' : variant;
    
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={id} className="text-sm font-medium text-text-primary">
            {label}
          </label>
        )}
        <input
          id={id}
          ref={ref}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : helperText ? `${id}-helper` : undefined}
          data-testid={testId}
          className={cn(inputVariants({ variant: inputVariant, size, className }))}
          {...props}
        />
        {error && (
          <p id={`${id}-error`} className="text-xs text-error">
            {error}
          </p>
        )}
        {!error && helperText && (
          <p id={`${id}-helper`} className="text-xs text-text-secondary">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
