import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const skeletonVariants = cva('animate-pulse bg-bg-muted', {
  variants: {
    variant: {
      block: 'rounded-md',
      text: 'h-4 w-full rounded',
      avatar: 'h-10 w-10 rounded-full',
    },
  },
  defaultVariants: {
    variant: 'block',
  },
});

export interface SkeletonProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof skeletonVariants> {}

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, variant, ...props }, ref) => {
    return <div ref={ref} className={cn(skeletonVariants({ variant, className }))} {...props} />;
  },
);

Skeleton.displayName = 'Skeleton';
