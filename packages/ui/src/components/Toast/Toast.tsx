import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const toastVariants = cva(
  'pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all',
  {
    variants: {
      variant: {
        default: 'border-border bg-surface text-fg',
        danger: 'border-danger/50 bg-danger/10 text-danger',
        success: 'border-success/50 bg-success/10 text-success',
        warning: 'border-warning/50 bg-warning/10 text-warning',
        info: 'border-info/50 bg-info/10 text-info',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface ToastProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof toastVariants> {}

export const Toast = forwardRef<HTMLDivElement, ToastProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="status"
        aria-live="polite"
        className={cn(toastVariants({ variant }), className)}
        {...props}
      />
    );
  }
);
Toast.displayName = 'Toast';

export const ToastTitle = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm font-semibold', className)} {...props} />
  )
);
ToastTitle.displayName = 'ToastTitle';

export const ToastDescription = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm opacity-90', className)} {...props} />
  )
);
ToastDescription.displayName = 'ToastDescription';
