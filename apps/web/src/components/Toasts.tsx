import React from 'react';
import { Toast, ToastDescription, ToastTitle } from '@automate/ui';

/**
 * One place that says "that worked" or "that failed", where the person is looking, and then
 * goes away.
 *
 * Built on the `Toast` that `packages/ui` has always shipped and nothing used. At most three
 * at once, newest at the bottom, each gone after five seconds — a stack that grows is a
 * second inbox, which is the opposite of what a confirmation is for. Without a provider
 * (a component rendered alone in a test) `useToast` is a no-op, so no screen has to know.
 */
export interface ToastMessage {
  tone: 'success' | 'danger' | 'info';
  title: string;
  description?: string;
}

interface Shown extends ToastMessage {
  id: number;
}

const ToastContext = React.createContext<(message: ToastMessage) => void>(() => undefined);

export const TOAST_MS = 5_000;
const MAX_SHOWN = 3;

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [shown, setShown] = React.useState<Shown[]>([]);
  const next = React.useRef(0);
  const push = React.useCallback((message: ToastMessage) => {
    next.current += 1;
    const id = next.current;
    setShown((current) => [...current, { ...message, id }].slice(-MAX_SHOWN));
    setTimeout(() => setShown((current) => current.filter((toast) => toast.id !== id)), TOAST_MS);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-4 bottom-20 z-toast flex flex-col gap-2 sm:left-auto sm:right-6 sm:bottom-6 sm:w-96"
      >
        {shown.map((toast) => (
          <Toast key={toast.id} variant={toast.tone} data-state="entering" data-testid="toast">
            <div>
              <ToastTitle>{toast.title}</ToastTitle>
              {toast.description === undefined ? null : (
                <ToastDescription>{toast.description}</ToastDescription>
              )}
            </div>
          </Toast>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (message: ToastMessage) => void {
  return React.useContext(ToastContext);
}
