import React from 'react';
import { Card, Badge, Button } from '@automate/ui';
import { suggestFlakyFixes, type FlakySuggestion, type FixType } from '../../services/flaky-fix-suggestions.js';
import type { FlakyTest } from '../../services/flaky-detection.js';

interface FlakyFixPanelProps {
  test: FlakyTest;
  onClose?: () => void;
}

const FIX_TYPE_LABELS: Record<FixType, string> = {
  'add-wait': 'Add Wait',
  'stabilize-selector': 'Stabilize Selector',
  'add-retry': 'Add Retry',
  'isolate-state': 'Isolate State',
};

const FIX_TYPE_VARIANTS: Record<FixType, 'warning' | 'default' | 'secondary'> = {
  'add-wait': 'warning',
  'stabilize-selector': 'default',
  'add-retry': 'warning',
  'isolate-state': 'secondary',
};

function SuggestionCard({ suggestion }: { suggestion: FlakySuggestion }) {
  return (
    <Card data-testid={`suggestion-${suggestion.type}`} className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant={FIX_TYPE_VARIANTS[suggestion.type]}>
          {FIX_TYPE_LABELS[suggestion.type]}
        </Badge>
      </div>
      <p className="text-sm text-text-secondary">{suggestion.description}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-text-secondary mb-1">Before</p>
          <pre
            data-testid={`code-before-${suggestion.type}`}
            className="text-xs bg-bg-elevated border border-border-default rounded p-2 overflow-x-auto whitespace-pre-wrap"
          >
            {suggestion.codeBefore}
          </pre>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-text-secondary mb-1">After</p>
          <pre
            data-testid={`code-after-${suggestion.type}`}
            className="text-xs bg-bg-elevated border border-border-default rounded p-2 overflow-x-auto whitespace-pre-wrap"
          >
            {suggestion.codeAfter}
          </pre>
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          data-testid={`apply-${suggestion.type}`}
          onClick={() => {
            // Placeholder: apply logic would be wired to an editor integration
          }}
        >
          Apply
        </Button>
      </div>
    </Card>
  );
}

export function FlakyFixPanel({ test, onClose }: FlakyFixPanelProps) {
  const suggestions = suggestFlakyFixes(test);

  return (
    <div data-testid="flaky-fix-panel" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Fix Suggestions</h3>
          <p className="text-sm text-text-secondary">{test.testName}</p>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="close-panel">
            ✕
          </Button>
        )}
      </div>

      {suggestions.length === 0 ? (
        <div data-testid="no-suggestions" className="text-sm text-text-secondary py-4 text-center">
          No fix suggestions available for this test.
        </div>
      ) : (
        <div className="space-y-3" data-testid="suggestions-list">
          {suggestions.map((s) => (
            <SuggestionCard key={s.type} suggestion={s} />
          ))}
        </div>
      )}
    </div>
  );
}
