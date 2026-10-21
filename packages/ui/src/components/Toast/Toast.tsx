import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

/**
 * The neutral toast is the raised plane step at overlay elevation. The four status
 * variants tint their own fill, because a status fill carries meaning rather than surface.
 */
const toastVariants = cva(
  /*
   * `transition-[opacity,transform]`, not `transition-all`.
   *
   * `transition-all` transitions every property the element has, now and after the next
   * component change — which is how a colour starts animating on hover by accident and
   * nobody decides it. Opacity and transform are the two this element actually moves, and
   * they are both compositor properties, so the toast's appearance and its disappearance
   * cost the same whether one toast is on screen or ten.
   *
   * **The toast enters and leaves.** `data-[state=entering]:animate-fade-in` and
   * `data-[state=leaving]:animate-fade-out` are the two halves of the pair, at the enter and
   * exit durations and easings respectively. A toast that only has an entry animation
   * disappears by being unmounted, which is not a thing a person can see.
   *
   * `motion.vocabulary.test.ts` asserts that this file says which of those it is, because
   * an overlay that "animates" has no direction and the next one copies its neighbour.
   */
  'pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 transition-[opacity,transform] duration-200 data-[state=entering]:animate-fade-in data-[state=leaving]:animate-fade-out',
  {
    variants: {
      variant: {
        default: 'border-border bg-surface-raised text-fg shadow-elevation-2',
        danger: 'border-danger/50 bg-danger/10 text-danger shadow-lg',
        success: 'border-success/50 bg-success/10 text-success shadow-lg',
        warning: 'border-warning/50 bg-warning/10 text-warning shadow-lg',
        info: 'border-info/50 bg-info/10 text-info shadow-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface ToastProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof toastVariants> {}

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
  },
);
Toast.displayName = 'Toast';

export const ToastTitle = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm font-semibold', className)} {...props} />
  ),
);
ToastTitle.displayName = 'ToastTitle';

export const ToastDescription = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm opacity-90', className)} {...props} />
  ),
);
ToastDescription.displayName = 'ToastDescription';
