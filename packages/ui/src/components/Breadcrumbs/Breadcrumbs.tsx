import { forwardRef, type HTMLAttributes } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps extends HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[];
}

export const Breadcrumbs = forwardRef<HTMLElement, BreadcrumbsProps>(
  ({ items, className, ...props }, ref) => {
    return (
      <nav
        ref={ref}
        aria-label="breadcrumb"
        className={cn('flex items-center text-sm text-text-secondary overflow-hidden', className)}
        {...props}
      >
        <ol className="flex items-center truncate">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;

            return (
              <li key={index} className="flex items-center">
                {isLast || !item.href ? (
                  <span
                    className={cn(
                      'truncate',
                      isLast ? 'font-medium text-text-primary' : ''
                    )}
                    aria-current={isLast ? 'page' : undefined}
                  >
                    {item.label}
                  </span>
                ) : (
                  <a
                    href={item.href}
                    className="truncate hover:text-text-primary hover:underline transition-colors"
                  >
                    {item.label}
                  </a>
                )}

                {!isLast && (
                  <ChevronRight
                    className="mx-2 h-4 w-4 shrink-0 text-text-muted"
                    data-testid="breadcrumb-separator"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    );
  }
);

Breadcrumbs.displayName = 'Breadcrumbs';
