import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

/**
 * Three placeholders, and each one carries its own dimensions.
 *
 * **`block` did not, and that made `<Skeleton />` render nothing.** The variant was
 * `rounded-md` alone, so the default — which is `block` — produced a div with no
 * height and no width: a 0-height element that occupies the space of the text it
 * was standing in for and is invisible in it. `gaps.tsx:51` asks for one while the
 * coverage gaps are loading, and the page showed nothing at all: an empty region
 * where a list was coming, which is exactly what a load state must not be.
 *
 * `text` and `avatar` had always carried `h-` and `w-`, which is why this survived
 * so long in the other two variants — the component looked right in every story
 * that used them.
 *
 * `width` and `height` override the variant's dimensions, so a caller who wants a
 * 96px circle gets `variant="avatar"` plus numbers rather than a new variant.
 */
const skeletonVariants = cva('animate-pulse bg-bg-muted', {
  variants: {
    variant: {
      /** One line of body text and the full width of its container. */
      block: 'h-4 w-full rounded-md',
      text: 'h-4 w-full rounded',
      avatar: 'h-10 w-10 rounded-full',
    },
  },
  defaultVariants: {
    variant: 'block',
  },
});

export interface SkeletonProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof skeletonVariants> {
  width?: string | number;
  height?: string | number;
}

/** `width`/`height` as an inline style, or `undefined` so the variant wins. */
function dimension(
  value: string | number | undefined,
  property: 'width' | 'height',
): CSSProperties | undefined {
  if (value === undefined) return undefined;
  return { [property]: typeof value === 'number' ? `${String(value)}px` : value };
}

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, variant, width, height, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(skeletonVariants({ variant, className }))}
        style={{ ...dimension(width, 'width'), ...dimension(height, 'height') }}
        // A placeholder carries no information, so it is hidden rather than
        // announced: a screen reader reading "skeleton" on a page that is still
        // loading says nothing about what is coming, and says it twice.
        aria-hidden="true"
        {...props}
      />
    );
  },
);

Skeleton.displayName = 'Skeleton';
