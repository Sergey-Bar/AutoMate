import { forwardRef, type ReactNode, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

export interface AppShellProps extends HTMLAttributes<HTMLDivElement> {
  header?: ReactNode;
  sidebar?: ReactNode;
  footer?: ReactNode;
}

export const AppShell = forwardRef<HTMLDivElement, AppShellProps>(
  ({ className, header, sidebar, footer, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('flex min-h-screen flex-col bg-surface text-fg', className)}
        {...props}
      >
        {header && (
          <header className="sticky top-0 z-10 w-full border-b border-border bg-surface">
            {header}
          </header>
        )}
        <div className="flex flex-1 overflow-hidden">
          {sidebar && (
            <aside className="w-64 border-r border-border bg-surface-muted overflow-y-auto">
              {sidebar}
            </aside>
          )}
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
        {footer && <footer className="border-t border-border bg-surface-muted">{footer}</footer>}
      </div>
    );
  },
);
AppShell.displayName = 'AppShell';
