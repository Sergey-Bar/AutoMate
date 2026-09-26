import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-lg transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:scale-[0.98]',
  {
    variants: {
      variant: {
        primary: 'font-medium text-white bg-primary hover:brightness-110',
        default: 'font-medium text-white bg-primary hover:brightness-110',
        secondary:
          'font-medium border bg-bg-elevated border-border-default text-text-primary hover:brightness-110',
        destructive: 'font-medium text-white bg-error hover:brightness-110',
        outline:
          'font-medium border bg-transparent border-border-default text-text-primary hover:brightness-110',
        ghost: 'font-medium bg-transparent text-text-secondary hover:brightness-110',
        link: 'font-medium bg-transparent text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs gap-1.5',
        md: 'h-9 px-3.5 text-sm gap-2',
        lg: 'h-11 px-5 text-sm gap-2.5',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export { buttonVariants };

type ButtonVariants = VariantProps<typeof buttonVariants>;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariants {
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  'data-testid'?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading,
      icon,
      iconRight,
      children,
      className = '',
      disabled,
      style,
      'data-testid': testId,
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        role="button"
        data-testid={testId}
        className={cn(
          buttonVariants({ variant, size }),
          isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
          className,
        )}
        style={style}
        {...rest}
      >
        {loading ? (
          <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin shrink-0" />
        ) : (
          icon && <span className="shrink-0">{icon}</span>
        )}
        {children}
        {iconRight && <span className="shrink-0">{iconRight}</span>}
      </button>
    );
  },
);

Button.displayName = 'Button';
