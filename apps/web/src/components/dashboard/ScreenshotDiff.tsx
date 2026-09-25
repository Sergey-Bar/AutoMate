import React, { useState } from 'react';
import { Button, Card } from '@automate/ui';

type ViewMode = 'side-by-side' | 'overlay' | 'diff';

export interface ScreenshotDiffProps {
  expected: string;
  actual: string;
  diff?: string;
}

export function ScreenshotDiff({ expected, actual, diff }: ScreenshotDiffProps) {
  const [mode, setMode] = useState<ViewMode>('side-by-side');

  return (
    <Card className="p-4" data-testid="screenshot-diff">
      <div className="flex gap-2 mb-4">
        <Button
          variant={mode === 'side-by-side' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('side-by-side')}
          data-testid="mode-side-by-side"
        >
          Side by Side
        </Button>
        <Button
          variant={mode === 'overlay' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('overlay')}
          data-testid="mode-overlay"
        >
          Overlay
        </Button>
        <Button
          variant={mode === 'diff' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('diff')}
          data-testid="mode-diff"
        >
          Diff
        </Button>
      </div>

      {mode === 'side-by-side' && (
        <div className="grid grid-cols-2 gap-4" data-testid="view-side-by-side">
          <div>
            <div className="text-xs text-text-secondary mb-1 font-medium">Expected</div>
            <img
              src={expected}
              alt="Expected screenshot"
              data-testid="screenshot-expected"
              className="w-full rounded border border-border"
            />
          </div>
          <div>
            <div className="text-xs text-text-secondary mb-1 font-medium">Actual</div>
            <img
              src={actual}
              alt="Actual screenshot"
              data-testid="screenshot-actual"
              className="w-full rounded border border-border"
            />
          </div>
        </div>
      )}

      {mode === 'overlay' && (
        <div className="relative" data-testid="view-overlay">
          <div className="text-xs text-text-secondary mb-1 font-medium">Overlay (Expected / Actual)</div>
          <div className="relative inline-block w-full">
            <img
              src={expected}
              alt="Expected screenshot"
              data-testid="overlay-expected"
              className="w-full rounded border border-border"
            />
            <img
              src={actual}
              alt="Actual screenshot"
              data-testid="overlay-actual"
              className="absolute inset-0 w-full rounded"
              style={{ opacity: 0.5 }}
            />
          </div>
        </div>
      )}

      {mode === 'diff' && (
        <div data-testid="view-diff">
          <div className="text-xs text-text-secondary mb-1 font-medium">Diff</div>
          {diff ? (
            <img
              src={diff}
              alt="Diff screenshot"
              data-testid="screenshot-diff-image"
              className="w-full rounded border border-border"
            />
          ) : (
            <div
              className="flex items-center justify-center h-32 text-text-secondary text-sm"
              data-testid="diff-unavailable"
            >
              No diff image available
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
