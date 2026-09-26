import { forwardRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

export interface TooltipProps extends Omit<HTMLAttributes<HTMLDivElement>, 'content'> {
  content: ReactNode;
}

export const Tooltip = forwardRef<HTMLDivElement, TooltipProps>(
  ({ className, content, children, ...props }, ref) => {
    const [isVisible, setIsVisible] = useState(false);

    return (
      <div
        className={cn('relative inline-block', className)}
        ref={ref}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        {...props}
      >
        {children}
        {isVisible && (
          <div
            className="absolute z-50 px-3 py-1.5 text-xs text-fg bg-surface-muted rounded-md shadow-md -top-2 left-1/2 transform -translate-x-1/2 -translate-y-full animate-in fade-in-0 zoom-in-95 pointer-events-none whitespace-nowrap border border-border"
            role="tooltip"
          >
            {content}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-border" />
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-surface-muted mt-[-1px]" />
          </div>
        )}
      </div>
    );
  },
);
Tooltip.displayName = 'Tooltip';
