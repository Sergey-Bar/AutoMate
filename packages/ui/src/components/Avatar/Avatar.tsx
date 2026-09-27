import { forwardRef, type HTMLAttributes, type ImgHTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';
import { cva, type VariantProps } from 'class-variance-authority';

const avatarVariants = cva('relative flex shrink-0 overflow-hidden rounded-full', {
  variants: {
    size: {
      sm: 'h-8 w-8',
      md: 'h-10 w-10',
      lg: 'h-12 w-12',
    },
  },
  defaultVariants: { size: 'md' },
});

export interface AvatarProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof avatarVariants> {}

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, size, ...props }, ref) => (
    <div ref={ref} className={cn(avatarVariants({ size, className }))} {...props} />
  ),
);
Avatar.displayName = 'Avatar';

export type AvatarImageProps = ImgHTMLAttributes<HTMLImageElement>;

export const AvatarImage = forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className, alt = '', ...props }, ref) => (
    // `alt` defaults to the empty string rather than being left to the caller.
    // An avatar image is a decoration for the identity that `AvatarFallback`
    // already carries, so a caller who forgets it gets "image" announced out of
    // nowhere; a caller with something to say still passes a real `alt`, which
    // overrides this default because it is spread after it.
    <img
      ref={ref}
      alt={alt}
      className={cn('aspect-square h-full w-full object-cover', className)}
      {...props}
    />
  ),
);
AvatarImage.displayName = 'AvatarImage';

export type AvatarFallbackProps = HTMLAttributes<HTMLDivElement>;

export const AvatarFallback = forwardRef<HTMLDivElement, AvatarFallbackProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex h-full w-full items-center justify-center rounded-full bg-surface-muted text-fg',
        className,
      )}
      {...props}
    />
  ),
);
AvatarFallback.displayName = 'AvatarFallback';
