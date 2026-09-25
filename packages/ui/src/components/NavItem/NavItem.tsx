import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

export interface NavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  badge?: number | string;
}

export const NavItem = forwardRef<HTMLAnchorElement, NavItemProps>(
  ({ label, icon, active, badge, className, ...props }, ref) => {
    return (
      <a
        ref={ref}
        className={cn(
          'group flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors',
          active
            ? 'bg-bg-muted text-text-primary'
            : 'text-text-secondary hover:bg-bg-muted hover:text-text-primary',
          className
        )}
        aria-current={active ? 'page' : undefined}
        {...props}
      >
        <div className="flex items-center gap-3">
          {icon && (
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center',
                active ? 'text-text-primary' : 'text-text-muted group-hover:text-text-primary'
              )}
            >
              {icon}
            </span>
          )}
          <span>{label}</span>
        </div>
        {badge !== undefined && (
          <span
            className={cn(
              'flex h-5 items-center justify-center rounded-full px-2 text-xs font-medium',
              active ? 'bg-text-primary text-bg-base' : 'bg-bg-elevated text-text-secondary'
            )}
          >
            {badge}
          </span>
        )}
      </a>
    );
  }
);

NavItem.displayName = 'NavItem';
