import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const buttonVariants = cva(
  /*
   * Flat and monochrome. `primary` is the one solid fill on a screen — the foreground tone
   * with the on-fill label, so white on black in dark and black on white in light — and
   * every other variant is a hairline or text. Hover changes the fill a step rather than
   * filtering it, because `brightness-110` on a near-white fill does nothing visible.
   */
  'inline-flex items-center justify-center rounded-md font-medium transition-[color,background-color,border-color,opacity,transform] duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:scale-press',
  {
    variants: {
      variant: {
        primary: 'text-on-fill bg-primary hover:opacity-90',
        default: 'text-on-fill bg-primary hover:opacity-90',
        secondary: 'border border-border-strong bg-transparent text-fg hover:bg-surface-muted',
        destructive: 'text-on-fill bg-error hover:opacity-90',
        outline: 'border border-border-strong bg-transparent text-fg hover:bg-surface-muted',
        ghost: 'bg-transparent text-fg-muted hover:bg-surface-muted hover:text-fg',
        link: 'bg-transparent text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg',
      },
      size: {
        sm: 'h-8 px-3 text-xs gap-1.5',
        md: 'h-10 px-4 text-sm gap-2',
        lg: 'h-12 px-6 text-sm gap-2.5',
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
