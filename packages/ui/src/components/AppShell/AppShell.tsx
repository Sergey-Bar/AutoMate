import { forwardRef, type ReactNode, type HTMLAttributes } from 'react';
import { GLASS_SURFACE_CLASSES } from '../../tokens/glass.js';
import { cn } from '../../lib/utils.js';

export interface AppShellProps extends HTMLAttributes<HTMLDivElement> {
  header?: ReactNode;
  sidebar?: ReactNode;
  footer?: ReactNode;
}

/**
 * The shell is where the material earns its keep, and the reason is positional rather than
 * decorative: the root is the **plane** — the thing everything is measured against — and
 * the header and sidebar are the two surfaces that sit over content which moves beneath
 * them. The header is sticky and the sidebar scrolls independently, so both sample a
 * backdrop that changes as the page does. That is the case glass is for.
 *
 * The root stays `bg-surface`. A translucent root would have no backdrop to sample, and
 * it would move the plane every contrast token in `theme.css` is measured against.
 */
export const AppShell = forwardRef<HTMLDivElement, AppShellProps>(
  ({ className, header, sidebar, footer, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        /*
         * The page plane, and the only place in the product the wash goes.
         *
         * `bg-page-wash` is a token published from `theme.css`, not a gradient written here: the
         * declaration lives next to the palette it interpolates, so retuning the wash is one edit
         * in one place and `theme.test.ts` reads it from there. Applying it to the shell root
         * rather than to any screen means every screen inherits it without any screen choosing it,
         * which is the property that keeps it on the page plane.
         *
         * The three planes above it — `surface-raised`, `surface-muted`, `surface-sunken` — are
         * opaque, so the wash cannot reach a card, a table or a figure. `theme.test.ts` asserts
         * both halves of that: the hue contrast recomputed over the strongest point of the wash,
         * and the opacity of every plane above the page.
         */
        className={cn('flex min-h-screen flex-col bg-surface bg-page-wash text-fg', className)}
        {...props}
      >
        {header && (
          <header
            className={cn(
              'sticky top-0 z-chrome w-full border-b border-border',
              GLASS_SURFACE_CLASSES,
            )}
          >
            {header}
          </header>
        )}
        <div className="flex flex-1 overflow-hidden">
          {sidebar && (
            <aside
              className={cn('w-64 border-r border-border overflow-y-auto', GLASS_SURFACE_CLASSES)}
            >
              {sidebar}
            </aside>
          )}
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
        {footer && (
          <footer className={cn('border-t border-border', GLASS_SURFACE_CLASSES)}>{footer}</footer>
        )}
      </div>
    );
  },
);
AppShell.displayName = 'AppShell';
