import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type DialogHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { cn } from '../../lib/utils.js';

/**
 * The selector for everything a user can Tab to inside a dialog.
 *
 * `:not([disabled])` and `:not([tabindex="-1"])` are spelled out rather than
 * left to a `:not([tabindex])` shortcut, because a dialog routinely contains
 * `tabIndex={-1}` elements (a scroll container, a heading) that must be skipped.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The tabbable descendants of `container`, in document order. */
function tabbableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getAttribute('aria-hidden') !== 'true',
  );
}

export interface DialogProps extends DialogHTMLAttributes<HTMLDialogElement> {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(
  ({ className, open, onOpenChange, children, ...props }, ref) => {
    const internalRef = useRef<HTMLDialogElement>(null);
    /**
     * The element focused when the dialog opened, so focus can go back there on
     * close. Native `<dialog>` restores focus in a browser, but only if the
     * dialog is still in the document, and only for a user-initiated close —
     * neither holds for an unmount or a React-driven `open` flip.
     */
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
        // Guarded because the trigger may itself be gone by the time the dialog
        // closes — an unmount is the usual cause.
        if (target && document.contains(target)) target.focus();
      };

      /*
       * Registered before the open/close below rather than in a sibling effect.
       * The open/close branch calls `dialog.close()`, which fires `close`
       * synchronously; a listener attached afterwards would have missed the very
       * event it exists to handle.
       */
      dialog.addEventListener('close', handleClose);

      if (open && !dialog.open) {
        returnFocusTo.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
        const [first] = tabbableWithin(dialog);
        (first ?? dialog).focus();
      } else if (!open && dialog.open) {
        dialog.close();
      }

      return () => dialog.removeEventListener('close', handleClose);
    }, [open, onOpenChange]);

    /**
     * Contain Tab inside the dialog.
     *
     * The native dialog traps focus in a browser, but jsdom does not implement
     * it, and neither does any environment where the polyfilled `showModal` path
     * runs — so the trap that the real UI depends on would be the one part with
     * no test coverage. Wrapping it explicitly means the behaviour under test is
     * the behaviour that ships.
     */
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

    return (
      <dialog
        ref={internalRef}
        className={cn(
          'backdrop:bg-surface/50 open:animate-fade-in open:duration-150 p-0 rounded-lg shadow-elevation-3 border border-border bg-surface text-fg max-w-lg w-full',
          className,
        )}
        onKeyDown={handleKeyDown}
        {...props}
        // After the spread, deliberately. A caller spreading `{...props}` over
        // this element used to be able to pass `aria-modal={false}` and silently
        // turn a modal dialog into a non-modal one, which is the difference
        // between "the rest of the page is hidden" and "a floating box".
        aria-modal="true"
        tabIndex={-1}
      >
        {children}
      </dialog>
    );
  },
);
Dialog.displayName = 'Dialog';

export const DialogContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-6', className)} {...props} />,
);
DialogContent.displayName = 'DialogContent';

export const DialogHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col space-y-1.5 text-center sm:text-left mb-4', className)}
      {...props}
    />
  ),
);
DialogHeader.displayName = 'DialogHeader';

export const DialogTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
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
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-fg-muted', className)} {...props} />
));
DialogDescription.displayName = 'DialogDescription';

export const DialogFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6',
        className,
      )}
      {...props}
    />
  ),
);
DialogFooter.displayName = 'DialogFooter';
