import { forwardRef, type ReactNode, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

export interface AppShellProps extends HTMLAttributes<HTMLDivElement> {
  header?: ReactNode;
  sidebar?: ReactNode;
  footer?: ReactNode;
}

/**
 * The page, flat.
 *
 * The root is the sunken plane and every region above it is an opaque step separated by a
 * hairline. There is no translucency and no wash: a figure is always read against the
 * colour `theme.css` declares for the surface it is on.
 */
export const AppShell = forwardRef<HTMLDivElement, AppShellProps>(
  ({ className, header, sidebar, footer, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('flex min-h-screen flex-col bg-surface-sunken text-fg', className)}
        {...props}
      >
        {header && (
          <header className="sticky top-0 z-chrome w-full border-b border-border bg-surface">
            {header}
          </header>
        )}
        <div className="flex flex-1 overflow-hidden">
          {sidebar && (
            <aside className="w-64 overflow-y-auto border-r border-border bg-surface">
              {sidebar}
            </aside>
          )}
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
        {footer && <footer className="border-t border-border bg-surface">{footer}</footer>}
      </div>
    );
  },
);
AppShell.displayName = 'AppShell';
