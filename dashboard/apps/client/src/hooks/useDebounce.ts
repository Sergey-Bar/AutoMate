import { useState, useEffect } from 'react';

/**
 * useDebounce — delays updating the returned value until `delayMs` ms
 * have elapsed since the last change to `value`.
 *
 * Used to prevent expensive re-renders (filter recomputation, URL updates)
 * on every keystroke. See VALID-05 requirement.
 *
 * @example
 *   const debouncedSearch = useDebounce(inputValue, 150);
 *   // debouncedSearch only updates 150ms after inputValue stops changing
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
