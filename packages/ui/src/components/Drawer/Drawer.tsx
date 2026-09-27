import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type DialogHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

/** See `Dialog.tsx` for why the selector is spelled out in full. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function tabbableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getAttribute('aria-hidden') !== 'true',
  );
}

export interface DrawerProps extends DialogHTMLAttributes<HTMLDialogElement> {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  position?: 'left' | 'right' | 'top' | 'bottom';
}

const drawerVariants = cva(
  'fixed z-50 bg-surface text-fg shadow-xl transition-transform duration-300 ease-in-out open:animate-in open:fade-in-90 backdrop:bg-surface/50 p-0 m-0',
  {
    variants: {
      position: {
        right: 'inset-y-0 right-0 h-full w-3/4 sm:max-w-sm border-l border-border',
        left: 'inset-y-0 left-0 h-full w-3/4 sm:max-w-sm border-r border-border',
        top: 'inset-x-0 top-0 w-full h-auto border-b border-border',
        bottom: 'inset-x-0 bottom-0 w-full h-auto border-t border-border mt-auto',
      },
    },
    defaultVariants: {
      position: 'right',
    },
  },
);

export const Drawer = forwardRef<HTMLDialogElement, DrawerProps>(
  ({ className, open, onOpenChange, position = 'right', children, ...props }, ref) => {
    const internalRef = useRef<HTMLDialogElement>(null);
    /** See `Dialog.tsx`. A drawer is a modal surface with the same obligation. */
    const returnFocusTo = useRef<HTMLElement | null>(null);

    useEffect(() => {
      if (typeof ref === 'function') {
        ref(internalRef.current);
      } else if (ref) {
        ref.current = internalRef.current;
      }
    }, [ref]);

    useEffect(() => {
      const dialog = internalRef.current;
      if (!dialog) return;

      const handleClose = () => {
        onOpenChange?.(false);
        const target = returnFocusTo.current;
        returnFocusTo.current = null;
        if (target && document.contains(target)) target.focus();
      };

      /*
       * Registered *before* the open/close below, not in a sibling effect.
       *
       * The element does not exist on the first render — `Drawer` renders `null`
       * while closed, so a sibling effect saw `internalRef.current === null` and
       * returned. With dependencies that never changed again, that listener was
       * never attached, so a native `close` (a user pressing Escape, which a
       * real browser fires without React being involved) reported nothing to
       * `onOpenChange` and left the controlled `open` state lying, and focus was
       * never returned to the trigger.
       */
      dialog.addEventListener('close', handleClose);

      if (open && !dialog.open) {
        returnFocusTo.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        // simple polyfill/check for showModal in tests
        if (dialog.showModal) {
          dialog.showModal();
        } else {
          dialog.open = true;
        }
        const [first] = tabbableWithin(dialog);
        (first ?? dialog).focus();
      } else if (!open && dialog.open) {
        if (dialog.close) {
          dialog.close();
        } else {
          dialog.open = false;
        }
      }

      return () => dialog.removeEventListener('close', handleClose);
    }, [open, onOpenChange]);

    /** See `Dialog.tsx`. The trap is the same obligation on a different surface. */
    const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDialogElement>) => {
      if (event.key !== 'Tab') return;
      const dialog = internalRef.current;
      if (!dialog) return;
      const focusable = tabbableWithin(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    }, []);

    // For testing purposes, if not open, we can just hide it completely,
    // but dialog element handles visibility. However, tests checking queryByTestId might fail if it's always in the DOM.
    // Native dialog is always in the DOM but hidden. Let's conditionally render if not open for easier testing,
    // OR we can just rely on standard dialog behavior.
    if (!open && !internalRef.current?.open) return null;

    return (
      <dialog
        ref={internalRef}
        className={cn(drawerVariants({ position }), className)}
        onKeyDown={handleKeyDown}
        {...props}
        // After the spread, deliberately — see `Dialog.tsx`. `aria-modal` is the
        // only thing that tells a screen reader the page behind this surface is
        // unavailable, and a spread could quietly take it away.
        aria-modal="true"
        tabIndex={-1}
      >
        {children}
      </dialog>
    );
  },
);
Drawer.displayName = 'Drawer';

// Wait, the tests use DrawerContent. Let me define DrawerContent.
// Actually it's easier to just use Drawer as the container.
// Let's create a DrawerContent that just passes through for structure.
export const DrawerContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { position?: 'left' | 'right' | 'top' | 'bottom' }
>(({ className, position: _position, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 h-full overflow-y-auto', className)} {...props} />
));
DrawerContent.displayName = 'DrawerContent';

export const DrawerHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 mb-4', className)} {...props} />
  ),
);
DrawerHeader.displayName = 'DrawerHeader';

export const DrawerTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, children, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn('text-lg font-semibold leading-none tracking-tight', className)}
      {...props}
    >
      {children}
    </h2>
  ),
);
DrawerTitle.displayName = 'DrawerTitle';
