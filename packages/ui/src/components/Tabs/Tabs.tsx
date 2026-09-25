import { createContext, forwardRef, useContext, useRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  triggerRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs components must be used within a Tabs provider');
  }
  return context;
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
}

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(
  ({ value, onValueChange, className, children, ...props }, ref) => {
    const triggerRefs = useRef(new Map<string, HTMLButtonElement>());

    return (
      <TabsContext.Provider value={{ value, onValueChange, triggerRefs }}>
        <div ref={ref} className={cn('w-full', className)} {...props}>
          {children}
        </div>
      </TabsContext.Provider>
    );
  }
);
Tabs.displayName = 'Tabs';

export const TabsList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="tablist"
        className={cn(
          'inline-flex h-10 items-center justify-center rounded-md bg-bg-muted p-1 text-text-secondary',
          className
        )}
        {...props}
      />
    );
  }
);
TabsList.displayName = 'TabsList';

export interface TabsTriggerProps extends HTMLAttributes<HTMLButtonElement> {
  value: string;
}

export const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ value, className, onClick, onKeyDown, ...props }, ref) => {
    const { value: selectedValue, onValueChange, triggerRefs } = useTabsContext();
    const isSelected = selectedValue === value;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const triggers = Array.from(triggerRefs.current.entries());
        const currentIndex = triggers.findIndex(([key]) => key === value);

        let nextIndex = currentIndex;
        if (e.key === 'ArrowRight') {
          nextIndex = (currentIndex + 1) % triggers.length;
        } else if (e.key === 'ArrowLeft') {
          nextIndex = (currentIndex - 1 + triggers.length) % triggers.length;
        }

        const nextTrigger = triggers[nextIndex];
        if (nextTrigger) {
          nextTrigger[1].focus();
          onValueChange(nextTrigger[0]);
        }
      }
      onKeyDown?.(e);
    };

    return (
      <button
        ref={(node) => {
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;

          if (node) {
            triggerRefs.current.set(value, node);
          } else {
            triggerRefs.current.delete(value);
          }
        }}
        role="tab"
        aria-selected={isSelected}
        aria-controls={`tabpanel-${value}`}
        id={`tab-${value}`}
        tabIndex={isSelected ? 0 : -1}
        onClick={(e) => {
          onValueChange(value);
          onClick?.(e);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-bg-base transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          isSelected && 'bg-bg-base text-text-primary shadow-sm',
          className
        )}
        {...props}
      />
    );
  }
);
TabsTrigger.displayName = 'TabsTrigger';

export interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
}

export const TabsContent = forwardRef<HTMLDivElement, TabsContentProps>(
  ({ value, className, children, ...props }, ref) => {
    const { value: selectedValue } = useTabsContext();
    const isSelected = selectedValue === value;

    if (!isSelected) return null;

    return (
      <div
        ref={ref}
        role="tabpanel"
        id={`tabpanel-${value}`}
        aria-labelledby={`tab-${value}`}
        tabIndex={0}
        className={cn(
          'mt-2 ring-offset-bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
TabsContent.displayName = 'TabsContent';
