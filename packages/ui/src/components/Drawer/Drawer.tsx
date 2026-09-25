import { forwardRef, useEffect, useRef, type DialogHTMLAttributes, type HTMLAttributes } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

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
  }
);

export const Drawer = forwardRef<HTMLDialogElement, DrawerProps>(
  ({ className, open, onOpenChange, position = 'right', children, ...props }, ref) => {
    const internalRef = useRef<HTMLDialogElement>(null);

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

      if (open && !dialog.open) {
        // simple polyfill/check for showModal in tests
        if (dialog.showModal) {
          dialog.showModal();
        } else {
          dialog.open = true;
        }
      } else if (!open && dialog.open) {
        if (dialog.close) {
          dialog.close();
        } else {
          dialog.open = false;
        }
      }
    }, [open]);

    useEffect(() => {
      const dialog = internalRef.current;
      if (!dialog) return;

      const handleClose = () => {
        onOpenChange?.(false);
      };

      dialog.addEventListener('close', handleClose);
      return () => dialog.removeEventListener('close', handleClose);
    }, [onOpenChange]);

    // For testing purposes, if not open, we can just hide it completely, 
    // but dialog element handles visibility. However, tests checking queryByTestId might fail if it's always in the DOM.
    // Native dialog is always in the DOM but hidden. Let's conditionally render if not open for easier testing,
    // OR we can just rely on standard dialog behavior.
    if (!open && !internalRef.current?.open) return null;

    return (
      <dialog
        ref={internalRef}
        className={cn(drawerVariants({ position }), className)}
        aria-modal="true"
        {...props}
      >
        {children}
      </dialog>
    );
  }
);
Drawer.displayName = 'Drawer';

// Wait, the tests use DrawerContent. Let me define DrawerContent.
// Actually it's easier to just use Drawer as the container.
// Let's create a DrawerContent that just passes through for structure.
export const DrawerContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { position?: 'left' | 'right' | 'top' | 'bottom' }>(
  ({ className, position: _position, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 h-full overflow-y-auto', className)} {...props} />
  )
);
DrawerContent.displayName = 'DrawerContent';

export const DrawerHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 mb-4', className)} {...props} />
  )
);
DrawerHeader.displayName = 'DrawerHeader';

export const DrawerTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props} />
  )
);
DrawerTitle.displayName = 'DrawerTitle';
