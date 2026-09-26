import {
  forwardRef,
  useState,
  cloneElement,
  type ReactElement,
  type HTMLAttributes,
  isValidElement,
} from 'react';
import { cn } from '../../lib/utils.js';

export interface PopoverProps {
  children: ReactElement[];
}

export function Popover({ children }: PopoverProps) {
  const [open, setOpen] = useState(false);

  // very basic compound component approach
  const trigger = children.find(
    (child) => isValidElement(child) && child.type === PopoverTrigger,
  ) as ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>> | undefined;
  const content = children.find(
    (child) => isValidElement(child) && child.type === PopoverContent,
  ) as ReactElement<React.HTMLAttributes<HTMLDivElement>> | undefined;

  return (
    <div className="relative inline-block">
      {trigger &&
        cloneElement(trigger, {
          onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
            setOpen(!open);
            if (trigger.props.onClick) trigger.props.onClick(e);
          },
          'aria-expanded': open,
        })}
      {open && content}
    </div>
  );
}

export const PopoverTrigger = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button ref={ref} type="button" className={className} {...props} />
));
PopoverTrigger.displayName = 'PopoverTrigger';

export const PopoverContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'absolute z-50 mt-2 w-72 rounded-md border border-border bg-surface p-4 text-fg shadow-md outline-none animate-in fade-in-0 zoom-in-95',
        className,
      )}
      {...props}
    />
  ),
);
PopoverContent.displayName = 'PopoverContent';
