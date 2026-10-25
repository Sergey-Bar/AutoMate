import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@automate/ui';

/**
 * Keyboard shortcuts, and the `?` sheet that lists them.
 *
 * Two-key "go to" chords (`g` then a letter, within a second) because single letters
 * would fire while someone is reading and taps a key. `j` / `k` move through the rows of
 * whatever list the page shows, `Enter` opens the focused one. Nothing fires while focus
 * is in a field, so typing a pairing code or a cron expression never navigates.
 */
export const GO_TO: Readonly<Record<string, { label: string; to: string }>> = {
  n: { label: 'Now', to: '/dashboard/now' },
  p: { label: 'Portfolio', to: '/dashboard/portfolio' },
  r: { label: 'Runs', to: '/dashboard/runs' },
  i: { label: 'Insights', to: '/dashboard/insights' },
  s: { label: 'Reports', to: '/dashboard/reports' },
  a: { label: 'Access', to: '/dashboard/access' },
};

/** The rows of the page itself — never the navigation around it. */
const ROWS = '[data-page] li, [data-page] tbody tr';
const CHORD_MS = 1_000;

/** Whether a keystroke belongs to a field rather than to the page. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('dialog, [role="dialog"]') !== null
  );
}

function moveRow(step: 1 | -1): void {
  const rows = [...document.querySelectorAll<HTMLElement>(ROWS)];
  if (rows.length === 0) return;
  const current = rows.findIndex(
    (row) => row === document.activeElement || row.contains(document.activeElement),
  );
  const next = rows[Math.min(rows.length - 1, Math.max(0, current + step))] ?? rows[0];
  if (next === undefined) return;
  next.tabIndex = -1;
  next.focus();
  next.scrollIntoView?.({ block: 'nearest' });
}

export function Shortcuts(): React.ReactElement {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const chord = React.useRef<number | null>(null);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (chord.current !== null && Date.now() - chord.current < CHORD_MS) {
        chord.current = null;
        const target = GO_TO[key];
        if (target !== undefined) {
          event.preventDefault();
          void navigate({ to: target.to });
        }
        return;
      }
      if (key === 'g') {
        chord.current = Date.now();
      } else if (event.key === '?') {
        event.preventDefault();
        setOpen(true);
      } else if (key === 'j') {
        moveRow(1);
      } else if (key === 'k') {
        moveRow(-1);
      } else if (event.key === 'Enter' && document.activeElement?.matches(ROWS) === true) {
        document.activeElement.querySelector<HTMLElement>('a, button')?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="shortcuts-help">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {Object.entries(GO_TO).map(([key, target]) => (
            <React.Fragment key={key}>
              <dt className="font-mono">g {key}</dt>
              <dd>Go to {target.label}</dd>
            </React.Fragment>
          ))}
          <dt className="font-mono">j / k</dt>
          <dd>Next / previous row</dd>
          <dt className="font-mono">Enter</dt>
          <dd>Open the focused row</dd>
          <dt className="font-mono">Ctrl K</dt>
          <dd>Command palette</dd>
          <dt className="font-mono">?</dt>
          <dd>This list</dd>
        </dl>
      </DialogContent>
    </Dialog>
  );
}
