import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  cloneElement,
  type ReactElement,
  type HTMLAttributes,
  type RefAttributes,
  isValidElement,
} from 'react';
import { GLASS_SURFACE_CLASSES } from '../../tokens/glass.js';
import { cn } from '../../lib/utils.js';

export interface PopoverProps {
  children: ReactElement[];
}

/**
 * `RefAttributes` is part of the found-element type, not an afterthought: both
 * sub-components are `forwardRef` components, and this is the parent that
 * attaches the ref it needs to move focus in and out of them.
 */
type PopoverTriggerElement = ReactElement<
  React.ButtonHTMLAttributes<HTMLButtonElement> & RefAttributes<HTMLButtonElement>
>;
type PopoverContentElement = ReactElement<
  HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>
>;

export function Popover({ children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  /**
   * `useId` rather than a counter: two popovers on one page must not share an
   * id, and `aria-controls` pointing at another popover's panel is worse than
   * having no `aria-controls` at all.
   */
  const generatedId = useId();

  // very basic compound component approach
  const trigger = children.find(
    (child) => isValidElement(child) && child.type === PopoverTrigger,
  ) as PopoverTriggerElement | undefined;
  const content = children.find(
    (child) => isValidElement(child) && child.type === PopoverContent,
  ) as PopoverContentElement | undefined;

  /**
   * Move focus into the panel when it opens.
   *
   * Without this the popover opens with focus still on the trigger, so a
   * keyboard user's next Tab lands on whatever follows in the page rather than
   * inside the content they just revealed.
   */
  useEffect(() => {
    if (open) contentRef.current?.focus();
  }, [open]);

  /**
   * Close, and by default hand focus back to the trigger.
   *
   * Both halves matter. Closing without restoring focus drops the user at the top
   * of the document with no idea what just happened, and Escape doing nothing
   * leaves a keyboard user with no way to dismiss a non-modal overlay.
   */
  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  /**
   * Escape closes and hands focus back to the trigger.
   *
   * Bound on `document` rather than on a wrapper `<div>` for two reasons. The
   * focus can be on the trigger or inside the panel depending on when Escape is
   * pressed, and a document listener covers both; and a keydown handler on a
   * plain wrapper would make a non-interactive element interactive, which is
   * exactly the sort of thing jsx-a11y exists to prevent.
   */
  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [close, open]);

  // A consumer's own id wins, and `aria-controls` then has to name that one.
  const contentId = content?.props.id ?? generatedId;
  /**
   * `role="dialog"` needs an accessible name or axe reports
   * `aria-dialog-name`, and a hardcoded default would be the *worst* way to
   * satisfy it — it would replace a name the caller deliberately supplied. So the
   * default is only injected when the caller gave neither `aria-label` nor
   * `aria-labelledby`.
   */
  const hasOwnName =
    content?.props['aria-label'] !== undefined || content?.props['aria-labelledby'] !== undefined;

  return (
    <div className="relative inline-block">
      {trigger &&
        cloneElement(trigger, {
          ref: triggerRef,
          onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
            setOpen(!open);
            if (trigger.props.onClick) trigger.props.onClick(e);
          },
          // `aria-haspopup` says the trigger opens something, and `aria-controls`
          // says what: a screen-reader user can then ask for the panel instead of
          // tabbing blindly to discover whether anything appeared.
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-controls': contentId,
        })}
      {open &&
        content &&
        cloneElement(content, {
          ref: contentRef,
          id: contentId,
          role: 'dialog',
          'aria-label': hasOwnName ? content.props['aria-label'] : 'Popover',
          tabIndex: -1,
        })}
    </div>
  );
}

export const PopoverTrigger = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    // The trigger is a tab stop, and it shipped with no focus indicator at all while
    // `PopoverContent` shipped `outline-none` with nothing in its place. Both halves are
    // the same defect: a keyboard user could open the panel and could not see where they
    // had arrived from, nor come back to it.
    className={cn(
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
      className,
    )}
    {...props}
  />
));
PopoverTrigger.displayName = 'PopoverTrigger';

export const PopoverContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // `outline-none` stays, and it is correct here: this panel is focused
        // programmatically when it opens so a keyboard user's next Tab lands inside it,
        // and a 2px outline around a box the moment it appears is noise rather than
        // information. The ring the *trigger* carries is what says where focus came from
        // and where it went back to, and the accessibility sweep asserts that pairing.
        /*
         * **The popover scales from its anchor** — the `enter, anchored` role. From 95%,
         * not from 0: the panel belongs to the control the reader just pressed, and a scale
         * from zero reads as a new object appearing rather than as that control's panel
         * opening. `origin-top` is set here rather than in the keyframe because the origin
         * belongs to the anchor and only the component knows which edge it is on.
         */
        'absolute z-popover mt-2 w-72 origin-top rounded-md border border-border p-4 text-fg outline-none animate-zoom-in-95 duration-150',
        GLASS_SURFACE_CLASSES,
        className,
      )}
      {...props}
    />
  ),
);
PopoverContent.displayName = 'PopoverContent';
