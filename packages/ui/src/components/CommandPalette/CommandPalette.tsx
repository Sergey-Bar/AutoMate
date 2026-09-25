import { forwardRef, useEffect, useState, useRef, type HTMLAttributes } from 'react';
import { Search } from 'lucide-react';
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

    const setIsOpen = (v: boolean) => {
      if (onOpenChange) onOpenChange(v);
      if (controlledOpen === undefined) setUncontrolledOpen(v);
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
      ? actions.filter(a => a.label.toLowerCase().includes(query.toLowerCase()))
      : actions.filter(a => recentIds.includes(a.id)).concat(actions.filter(a => !recentIds.includes(a.id))); // Recent first when empty query

    const handleSelect = (action: CommandAction) => {
      action.onSelect();
      
      const newRecent = [action.id, ...recentIds.filter(id => id !== action.id)].slice(0, MAX_RECENT);
      setRecentIds(newRecent);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(newRecent));
      } catch (_e) {
        // Ignore
      }

      setIsOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filteredActions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const action = filteredActions[selectedIndex];
        if (action) {
          handleSelect(action);
        }
      }
    };

    if (!isOpen) return null;

    return (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[20vh] p-4 animate-in fade-in duration-200">
        <div
          ref={ref}
          className={cn(
            'w-full max-w-xl overflow-hidden rounded-xl border border-border-default bg-bg-elevated shadow-2xl animate-in zoom-in-95 duration-200',
            className
          )}
          {...props}
        >
          <div className="flex items-center border-b border-border-default px-3">
            <Search className="h-5 w-5 text-text-muted shrink-0" />
            <input
              ref={inputRef}
              type="text"
              className="flex h-12 w-full bg-transparent py-3 pl-3 pr-2 text-sm outline-none placeholder:text-text-muted text-text-primary"
              placeholder="Type a command or search..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto p-2">
            {filteredActions.length === 0 ? (
              <div className="py-6 text-center text-sm text-text-secondary">
                No results found.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {filteredActions.map((action, index) => {
                  const isSelected = index === selectedIndex;
                  return (
                    <button
                      key={action.id}
                      onClick={() => handleSelect(action)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={cn(
                        'flex w-full items-center rounded-md px-3 py-2 text-sm text-left transition-colors',
                        isSelected ? 'bg-brand-50 text-brand-700 font-medium' : 'text-text-secondary hover:bg-bg-muted hover:text-text-primary'
                      )}
                    >
                      {action.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
);

CommandPalette.displayName = 'CommandPalette';
