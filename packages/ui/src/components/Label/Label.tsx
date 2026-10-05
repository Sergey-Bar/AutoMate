import { forwardRef, type LabelHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const labelVariants = cva(
  'text-sm font-medium text-fg leading-tight peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
);

export interface LabelProps
  extends LabelHTMLAttributes<HTMLLabelElement>, VariantProps<typeof labelVariants> {}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, htmlFor, children, ...props }, ref) => (
    // `htmlFor` is written out rather than left in the spread so that the
    // association with a control is a declared part of this component instead of
    // an accident of what a caller happened to pass. Without it a `<label>` is
    // announced as an unassociated label, which tells a screen-reader user
    // nothing about which field it belongs to.
    <label ref={ref} htmlFor={htmlFor} className={cn(labelVariants(), className)} {...props}>
      {children}
    </label>
  ),
);
Label.displayName = 'Label';
