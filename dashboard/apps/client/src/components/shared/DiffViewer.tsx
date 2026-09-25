/** DiffViewer — 3-panel Expected | Diff | Actual screenshot viewer */
interface DiffViewerProps {
  expectedUrl?: string;
  actualUrl?: string;
  diffUrl?: string;
}

export function DiffViewer({ expectedUrl, actualUrl, diffUrl }: DiffViewerProps) {
  const panels = [
    { label: 'Expected', url: expectedUrl },
    { label: 'Diff',     url: diffUrl },
    { label: 'Actual',   url: actualUrl },
  ].filter((p) => p.url);

  if (panels.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-text-tertiary">
        No screenshots available
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto">
      {panels.map(({ label, url }) => (
        <div key={label} className="flex-1 min-w-0">
          <p
            className="text-[11px] font-medium mb-1.5 uppercase tracking-wider text-text-tertiary"
          >
            {label}
          </p>
          <div className="rounded-lg overflow-hidden border border-border-default">
            <img
              src={url}
              alt={label}
              className="w-full h-auto object-contain bg-bg-elevated"
              style={{ maxHeight: 320 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
