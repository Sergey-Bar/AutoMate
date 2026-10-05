import {
  forwardRef,
  useEffect,
  useId,
  useState,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Search } from 'lucide-react';
import { GLASS_SURFACE_CLASSES } from '../../tokens/glass.js';
import { cn } from '../../lib/utils.js';

export interface CommandAction {
  id: string;
  label: string;
  onSelect: () => void;
}

export interface CommandPaletteProps extends HTMLAttributes<HTMLDivElement> {
  actions: CommandAction[];
  open?: boolean; // Can be controlled externally
  onOpenChange?: (open: boolean) => void;
}

const RECENT_KEY = 'automate-cmd-recent';
const MAX_RECENT = 8;

export const CommandPalette = forwardRef<HTMLDivElement, CommandPaletteProps>(
  ({ actions, open: controlledOpen, onOpenChange, className, ...props }, ref) => {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const isOpen = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [recentIds, setRecentIds] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const listboxId = useId();
    /**
     * Focus has to come back wherever the user was when they hit Ctrl+K.
     * `setIsOpen(false)` unmounts the panel in the same commit, so by the time a
     * plain `focus()` ran there would be nothing to focus and the user would be
     * dropped at the top of the document.
     */
    const returnFocusTo = useRef<HTMLElement | null>(null);

    const setIsOpen = (v: boolean) => {
      if (v) {
        returnFocusTo.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      if (onOpenChange) onOpenChange(v);
      if (controlledOpen === undefined) setUncontrolledOpen(v);
      if (!v) {
        const target = returnFocusTo.current;
        returnFocusTo.current = null;
        if (target && document.contains(target)) target.focus();
      }
    };

    useEffect(() => {
      try {
        const stored = localStorage.getItem(RECENT_KEY);
        if (stored) {
          setRecentIds(JSON.parse(stored));
        }
      } catch (_e) {
        // Ignore
      }
    }, []);

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault();
          setIsOpen(!isOpen);
        }
        if (e.key === 'Escape' && isOpen) {
          e.preventDefault();
          setIsOpen(false);
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    useEffect(() => {
      if (isOpen) {
        setQuery('');
        setSelectedIndex(0);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }, [isOpen]);

    const filteredActions = query
      ? actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()))
      : actions
          .filter((a) => recentIds.includes(a.id))
          .concat(actions.filter((a) => !recentIds.includes(a.id))); // Recent first when empty query

    const handleSelect = (action: CommandAction) => {
      action.onSelect();

      const newRecent = [action.id, ...recentIds.filter((id) => id !== action.id)].slice(
        0,
        MAX_RECENT,
      );
      setRecentIds(newRecent);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(newRecent));
      } catch (_e) {
        // Ignore
      }

      setIsOpen(false);
    };

    const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredActions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const action = filteredActions[selectedIndex];
        if (action) {
          handleSelect(action);
        }
      } else if (e.key === 'Tab') {
        // The panel holds exactly one tab stop — the input. Letting Tab escape to
        // the page behind a full-screen overlay strands the user in content they
        // cannot see, and Shift+Tab does the same in reverse.
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    if (!isOpen) return null;

    const activeId =
      filteredActions.length > 0 ? `${listboxId}-option-${selectedIndex}` : undefined;

    return (
      <div className="fixed inset-0 z-modal bg-black/50 flex items-start justify-center pt-[20vh] p-4 animate-fade-in duration-200">
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className={cn(
            'w-full max-w-xl overflow-hidden rounded-xl border border-border-default animate-zoom-in-95 duration-200',
            GLASS_SURFACE_CLASSES,
            className,
          )}
          {...props}
        >
          <div className="flex items-center border-b border-border-default px-3">
            <Search className="h-5 w-5 text-text-muted shrink-0" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              /*
               * The combobox pattern. Without `role="combobox"` the input is just
               * a text field: nothing tells a screen-reader user that a list of
               * options exists below it, that it is filtered as they type, or
               * which option Enter will run — even though all three are true.
               * `aria-activedescendant` is what makes the arrow keys audible,
               * because focus never leaves the input.
               */
              role="combobox"
              aria-expanded={true}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              className="flex h-12 w-full bg-transparent py-3 pl-3 pr-2 text-sm placeholder:text-text-muted text-text-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-focus"
              placeholder="Type a command or search..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div
            id={listboxId}
            role="listbox"
            aria-label="Commands"
            className="max-h-[300px] overflow-y-auto p-2"
          >
            {filteredActions.length === 0 ? (
              <div className="py-6 text-center text-sm text-text-secondary">No results found.</div>
            ) : (
              <div className="flex flex-col gap-1">
                {filteredActions.map((action, index) => {
                  const isSelected = index === selectedIndex;
                  return (
                    <div
                      key={action.id}
                      id={`${listboxId}-option-${index}`}
                      role="option"
                      aria-selected={isSelected}
                      // Not a tab stop: in a combobox the DOM focus belongs to the
                      // input and the active option is conveyed by
                      // `aria-activedescendant`, so a second tab stop here would
                      // put the user out of step with what is announced.
                      tabIndex={-1}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelect(action);
                      }}
                      className={cn(
                        'flex w-full cursor-pointer items-center rounded-md px-3 py-2 text-sm text-left transition-colors',
                        isSelected
                          ? 'bg-brand-50 text-brand-700 font-medium'
                          : 'text-text-secondary hover:bg-bg-muted hover:text-text-primary',
                      )}
                    >
                      {action.label}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);

CommandPalette.displayName = 'CommandPalette';
