import { forwardRef, useEffect, useRef, type DialogHTMLAttributes, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

export interface DialogProps extends DialogHTMLAttributes<HTMLDialogElement> {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(
  ({ className, open, onOpenChange, children, ...props }, ref) => {
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
        dialog.showModal();
      } else if (!open && dialog.open) {
        dialog.close();
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

    return (
      <dialog
        ref={internalRef}
        className={cn(
          'backdrop:bg-surface/50 open:animate-in open:fade-in-90 p-0 rounded-lg shadow-lg border border-border bg-surface text-fg max-w-lg w-full',
          className
        )}
        aria-modal="true"
        {...props}
      >
        {children}
      </dialog>
    );
  }
);
Dialog.displayName = 'Dialog';

export const DialogContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6', className)} {...props} />
  )
);
DialogContent.displayName = 'DialogContent';

export const DialogHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 text-center sm:text-left mb-4', className)} {...props} />
  )
);
DialogHeader.displayName = 'DialogHeader';

export const DialogTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props} />
  )
);
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-fg-muted', className)} {...props} />
  )
);
DialogDescription.displayName = 'DialogDescription';

export const DialogFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6', className)} {...props} />
  )
);
DialogFooter.displayName = 'DialogFooter';
