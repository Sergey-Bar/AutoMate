import { ExternalLink } from 'lucide-react';

interface TraceViewerProps {
  tracePath: string;
}

export function TraceViewer({ tracePath }: TraceViewerProps) {
  const traceUrl = `/artifacts/${tracePath}`;
  const viewerUrl = `https://trace.playwright.dev/?trace=${encodeURIComponent(
    window.location.origin + traceUrl,
  )}`;

  return (
    <div className="flex flex-col gap-2 rounded-xl overflow-hidden border border-border-subtle">
      {/* Embedded iframe */}
      <iframe
        src={viewerUrl}
        className="w-full border-0"
        style={{ height: '600px' }}
        title="Playwright Trace Viewer"
        allow="same-origin"
      />

      {/* Open in new tab */}
      <div
        className="flex items-center justify-between px-3 py-2 border-t border-border-subtle bg-bg-elevated"
      >
        <span className="text-xs text-text-tertiary">
          Trace: {tracePath.split('/').pop()}
        </span>
        <a
          href={viewerUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs transition-colors hover:underline text-[var(--color-text-link)]"
        >
          Open in full tab
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}
