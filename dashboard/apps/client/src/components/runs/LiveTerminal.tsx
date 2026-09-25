import { useEffect, useRef, useState } from 'react';
import { useRunStore } from '@/store/runStore';
import { Copy, ArrowDown, Trash2 } from 'lucide-react';

// xterm types for refs (import type only — no runtime cost)
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

export function LiveTerminal() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const terminalOutput = useRunStore((s) => s.terminalOutput);
  const clearTerminal = useRunStore((s) => s.clearTerminal);
  const atBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [ready, setReady] = useState(false);

  // Initialize xterm on mount (lazy-loaded to reduce initial bundle)
  useEffect(() => {
    if (!terminalRef.current) return;

    let disposed = false;
    let term: Terminal | undefined;
    let ro: ResizeObserver | undefined;

    (async () => {
      const [
        { Terminal: XTerminal },
        { FitAddon: XFitAddon },
        { SearchAddon: XSearchAddon },
        { WebLinksAddon: XWebLinksAddon },
      ] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-search'),
        import('@xterm/addon-web-links'),
      ]);

      // Also load the CSS
      await import('@xterm/xterm/css/xterm.css');

      if (disposed || !terminalRef.current) return;

      term = new XTerminal({
        theme: {
          background: 'oklch(0.09 0.01 265)',
          foreground: 'oklch(0.94 0 0)',
          cursor: 'oklch(0.68 0.19 250)',
          selectionBackground: 'oklch(0.68 0.19 250 / 30%)',
          black: '#1e1e2e', brightBlack: '#45475a',
          red: 'oklch(0.67 0.22 25)', brightRed: 'oklch(0.67 0.22 25)',
          green: 'oklch(0.72 0.19 145)', brightGreen: 'oklch(0.72 0.19 145)',
          yellow: 'oklch(0.78 0.17 68)', brightYellow: 'oklch(0.78 0.17 68)',
          blue: 'oklch(0.68 0.19 250)', brightBlue: 'oklch(0.68 0.19 250)',
          magenta: 'oklch(0.627 0.265 303.9)', brightMagenta: 'oklch(0.627 0.265 303.9)',
          cyan: 'oklch(0.696 0.17 162.48)', brightCyan: 'oklch(0.696 0.17 162.48)',
          white: 'oklch(0.65 0 0)', brightWhite: 'oklch(0.94 0 0)',
        },
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.6,
        cursorBlink: false,
        disableStdin: true,
        scrollback: 10_000,
      });

      const fit = new XFitAddon();
      const search = new XSearchAddon();
      const webLinks = new XWebLinksAddon();

      term.loadAddon(fit);
      term.loadAddon(search);
      term.loadAddon(webLinks);
      term.open(terminalRef.current);
      fit.fit();

      xtermRef.current = term;
      fitRef.current = fit;

      // Track scroll position
      term.onScroll(() => {
        const viewport = terminalRef.current?.querySelector('.xterm-viewport');
        if (!viewport) return;
        const near = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 20;
        atBottomRef.current = near;
        setShowJumpToBottom(!near);
      });

      ro = new ResizeObserver(() => fit.fit());
      ro.observe(terminalRef.current);

      setReady(true);
    })();

    return () => {
      disposed = true;
      ro?.disconnect();
      term?.dispose();
    };
  }, []);

  // Write new chunks to terminal
  const prevLen = useRef(0);
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;

    const newChunks = terminalOutput.slice(prevLen.current);
    prevLen.current = terminalOutput.length;

    for (const chunk of newChunks) {
      term.write(chunk);
    }

    if (atBottomRef.current) {
      term.scrollToBottom();
    }
  }, [terminalOutput, ready]);

  function handleCopyAll() {
    const text = terminalOutput.join('');
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function handleClear() {
    xtermRef.current?.clear();
    clearTerminal();
    prevLen.current = 0;
  }

  function scrollToBottom() {
    xtermRef.current?.scrollToBottom();
    atBottomRef.current = true;
    setShowJumpToBottom(false);
  }

  return (
    <div
      className="flex flex-col h-full relative"
      style={{ background: 'oklch(0.09 0.01 265)' }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 h-8 border-b border-border-subtle shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
          Terminal
        </span>
        <div className="flex items-center gap-2">
          <button onClick={handleClear} className="opacity-50 hover:opacity-100 transition-opacity" title="Clear" aria-label="Clear">
            <Trash2 size={12} className="text-text-secondary" />
          </button>
          <button onClick={handleCopyAll} className="opacity-50 hover:opacity-100 transition-opacity" title="Copy all" aria-label="Copy all">
            <Copy size={12} className="text-text-secondary" />
          </button>
        </div>
      </div>

      {/* xterm container */}
      <div ref={terminalRef} className="flex-1 min-h-0 p-2" />

      {/* Jump to bottom FAB */}
      {showJumpToBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-border-default bg-bg-elevated text-text-secondary shadow-lg"
        >
          <ArrowDown size={12} />
          Jump to bottom
        </button>
      )}
    </div>
  );
}
