import { useEffect, useRef } from 'react';

import { X } from 'lucide-react';

interface ShortcutsModalProps {
  onClose: () => void;
}

const SECTIONS: Array<{
  title: string;
  shortcuts: Array<{ keys: string[]; description: string }>;
}> = [
  {
    title: 'Global',
    shortcuts: [
      { keys: ['⌘', 'K'], description: 'Command palette' },
      { keys: ['['], description: 'Toggle sidebar' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['G', 'D'], description: 'Go to Dashboard' },
      { keys: ['G', 'R'], description: 'Go to Runs' },
      { keys: ['G', 'T'], description: 'Go to Tests' },
      { keys: ['G', 'A'], description: 'Go to Analytics' },
      { keys: ['G', 'S'], description: 'Go to Settings' },
      { keys: ['G', 'B'], description: 'Go to Baselines' },
      { keys: ['G', 'C'], description: 'Go to Config' },
    ],
  },
  {
    title: 'Run Detail',
    shortcuts: [
      { keys: ['J', '↓'], description: 'Next test' },
      { keys: ['K', '↑'], description: 'Previous test' },
      { keys: ['Esc'], description: 'Deselect test' },
    ],
  },
  {
    title: 'Test Explorer',
    shortcuts: [
      { keys: ['J', '↓'], description: 'Next test' },
      { keys: ['K', '↑'], description: 'Previous test' },
      { keys: ['Enter'], description: 'Open test detail' },
    ],
  },
];

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    
    const handleClose = () => onClose();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dialog.close();
      }
    };
    dialog.addEventListener('close', handleClose);
    window.addEventListener('keydown', handleEscape);
    return () => {
      dialog.removeEventListener('close', handleClose);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 rounded-xl border border-border-default bg-bg-surface shadow-2xl overflow-hidden"
      style={{
        padding: 0,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) dialogRef.current?.close(); }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle"
      >
        <h2
          id="shortcuts-modal-title"
          className="text-sm font-semibold text-text-primary"
        >
          Keyboard Shortcuts
        </h2>
        <button
          onClick={() => dialogRef.current?.close()}
          className="p-1 rounded text-text-tertiary transition-colors"
          aria-label="Close shortcuts"
        >
          <X size={14} />
        </button>
      </div>

      {/* Sections */}
      <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-5">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <h3
              className="text-[11px] font-semibold uppercase tracking-wider mb-2.5 text-text-tertiary"
            >
              {section.title}
            </h3>
            <div className="space-y-1.5">
              {section.shortcuts.map((shortcut) => (
                <div
                  key={shortcut.description}
                  className="flex items-center justify-between py-1"
                >
                  <span
                    className="text-xs text-text-secondary"
                  >
                    {shortcut.description}
                  </span>
                  <div className="flex items-center gap-1">
                    {shortcut.keys.map((key, i) => (
                      <kbd
                        key={i}
                        className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-border-default min-w-[22px] text-center text-text-secondary bg-bg-elevated"
                      >
                        {key}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </dialog>
  );

}
