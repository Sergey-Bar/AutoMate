import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * A flat panel: one opaque plane step and a hairline, no shadow.
 *
 * `border border-border` is the decorative edge, below 3:1 on purpose — a card is
 * grouped content, not a control, and a mid-grey line around every rectangle is noise.
 */
const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-xl border border-border bg-surface text-fg', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, children, ...props }, ref) => (
    <h3
      ref={ref}
      /*
       * `leading-snug` rather than `leading-none`. `leading-none` is `line-height: 1`,
       * which clips the descender of any glyph that has one — `j`, `p`, `q`, `y`, `g` —
       * and it is wrong at every size rather than only at small ones. `snug` is 1.375,
       * one of the six steps `theme.css` declares, so the value is the stylesheet's and a
       * component is not free-choosing a number.
       *
       * `text-balance` because a card title is short and may wrap to two lines, and a
       * two-line heading with one word on the second line reads as a mistake rather than
       * as a title.
       */
      className={cn('font-semibold leading-snug tracking-tight text-balance', className)}
      {...props}
    >
      {children}
    </h3>
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    /*
     * The measure and `text-pretty` both belong here rather than on the card: a card is a
     * panel of unknown width and a description is the one thing in it that is a sentence.
     * `pretty` stops the last line being a single short word; `max-w-measure` is the
     * ceiling `theme.css` declares for prose, and it is a ceiling, so a narrow card is
     * unaffected.
     */
    <p
      ref={ref}
      className={cn('max-w-measure text-pretty text-sm text-fg-muted', className)}
      {...props}
    />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
