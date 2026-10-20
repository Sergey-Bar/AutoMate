import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type DialogHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { X } from 'lucide-react';
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

/**
 * Where focus goes when the dialog opens.
 *
 * **The title, not the first button.** Focusing the first tabbable element put focus on
 * Copy in the toolbox's tool dialog and on Run in the runner's confirmation: an action was
 * armed before the reader had read what it acted on, and Enter performed it. A caller that
 * *does* want a control first — a form's first field — marks it `data-autofocus`.
 */
function initialFocus(dialog: HTMLDialogElement): HTMLElement {
  const chosen =
    dialog.querySelector<HTMLElement>('[data-autofocus]') ??
    dialog.querySelector<HTMLElement>('[data-dialog-title]') ??
    // A dialog whose content brings its own heading (a form with an `h2`) is read from
    // that heading too, made focusable by script only so it never becomes a Tab stop.
    dialog.querySelector<HTMLElement>('h1, h2, h3');
  if (chosen === null) return tabbableWithin(dialog)[0] ?? dialog;
  if (!chosen.hasAttribute('tabindex') && !chosen.matches(FOCUSABLE)) chosen.tabIndex = -1;
  return chosen;
}

/** Lets the header's close button close the dialog it sits in, without a prop chain. */
const DialogCloseContext = createContext<(() => void) | null>(null);

export interface DialogProps extends DialogHTMLAttributes<HTMLDialogElement> {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A modal dialog that can always be left.
 *
 * ## Three ways out, and every dialog has all three
 *
 * The close button in the header, a click on the backdrop, and Escape. Escape alone was a
 * trap: on a phone there is no Escape key, and a mouse user had nothing to click. The
 * toolbox's tool dialog shipped exactly that way (ledger `UX-DIALOG-1`).
 *
 * The backdrop counts only when the press **started** on it as well as ended there, so
 * selecting text in the dialog and releasing the mouse past its edge does not close it.
 */
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
        initialFocus(dialog).focus();
      } else if (!open && dialog.open) {
        dialog.close();
      }

      return () => dialog.removeEventListener('close', handleClose);
    }, [open, onOpenChange]);

    /*
     * Backdrop dismissal. Listeners rather than JSX handlers because a `<dialog>` is not an
     * interactive element to jsx-a11y, and the keyboard equivalent — Escape — is native.
     */
    useEffect(() => {
      const dialog = internalRef.current;
      if (!dialog) return;
      let pressedOnBackdrop = false;
      const onPointerDown = (event: Event) => {
        pressedOnBackdrop = event.target === dialog;
      };
      const onClick = (event: Event) => {
        const fromBackdrop = event.target === dialog && pressedOnBackdrop;
        pressedOnBackdrop = false;
        if (fromBackdrop && dialog.open) dialog.close();
      };
      dialog.addEventListener('pointerdown', onPointerDown);
      dialog.addEventListener('click', onClick);
      return () => {
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('click', onClick);
      };
    }, []);

    const close = useCallback(() => {
      const dialog = internalRef.current;
      if (dialog?.open) dialog.close();
    }, []);

    /**
     * Contain Tab inside the dialog.
     *
     * The native dialog traps focus in a browser, but jsdom does not implement
     * it, and neither does any environment where the polyfilled `showModal` path
     * runs — so the trap that the real UI depends on would be the one part with
     * no test coverage. Wrapping it explicitly means the behaviour under test is
     * the behaviour that ships.
     *
     * Focus can sit on something that is not a Tab stop — the title, on open — so the
     * position is found in the list rather than compared with its ends: from outside the
     * list, forwards is the first control and backwards is the last.
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
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      if (index === -1) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && index === 0) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && index === focusable.length - 1) {
        event.preventDefault();
        first?.focus();
      }
    }, []);

    const context = useMemo(() => close, [close]);

    return (
      <dialog
        ref={internalRef}
        className={cn(
          /*
           * **The dialog rises.** `animate-automate-slide-in` is the transition role:
           * opacity plus an 8% `translateY`, over 300 ms on `in-out`, because a dialog is
           * crossing the viewport and a panel that only fades in place reads as appearing
           * — which is the `enter` role, and a different thing.
           *
           * The name is the decision. `open:animate-fade-in` said "it animates" and left the
           * direction to whoever read it next, which is how a drawer, a dialog, a popover
           * and a palette all ended up on whatever the first one used.
           */
          // `m-auto` because preflight zeroes a dialog's margin, which pinned a tall dialog to the
          // top-left corner on a phone and left no backdrop to tap. The height cap keeps a
          // margin of backdrop on every side, and the dialog scrolls inside it instead.
          'backdrop:bg-surface/50 open:animate-automate-slide-in m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto p-0 rounded-2xl shadow-elevation-3 border border-border bg-surface-raised text-fg max-w-lg w-[calc(100%-2rem)]',
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
        <DialogCloseContext.Provider value={context}>{children}</DialogCloseContext.Provider>
      </dialog>
    );
  },
);
Dialog.displayName = 'Dialog';

/**
 * The visible way out: a 44px icon button, top right.
 *
 * Renders nothing outside a `Dialog`, because a close button that closes nothing is worse
 * than none.
 */
export function DialogClose({
  label = 'Close',
  className,
}: {
  label?: string;
  className?: string;
}) {
  const close = useContext(DialogCloseContext);
  if (close === null) return null;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={close}
      className={cn(
        'absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        className,
      )}
    >
      <X size={18} aria-hidden="true" />
    </button>
  );
}

export const DialogContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-6', className)} {...props} />,
);
DialogContent.displayName = 'DialogContent';

export interface DialogHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** The close button is on by default; a dialog that must be answered can turn it off. */
  showClose?: boolean;
  closeLabel?: string;
}

export const DialogHeader = forwardRef<HTMLDivElement, DialogHeaderProps>(
  ({ className, showClose = true, closeLabel, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col space-y-1.5 text-left mb-4',
        // Room for the close button, so a long title never runs under it.
        showClose && 'pr-10',
        className,
      )}
      {...props}
    >
      {children}
      {showClose ? (
        <DialogClose {...(closeLabel === undefined ? {} : { label: closeLabel })} />
      ) : null}
    </div>
  ),
);
DialogHeader.displayName = 'DialogHeader';

export const DialogTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, children, ...props }, ref) => (
    <h2
      ref={ref}
      // Focusable by script only, so it can take focus on open without becoming a Tab stop.
      tabIndex={-1}
      data-dialog-title=""
      className={cn(
        'text-lg font-semibold leading-snug tracking-tight text-balance outline-none',
        className,
      )}
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
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end mt-6', className)}
      {...props}
    />
  ),
);
DialogFooter.displayName = 'DialogFooter';
