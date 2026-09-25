import React from 'react';
import { Skeleton } from '@automate/ui';

export interface AgentStep {
  type: 'navigate' | 'click' | 'screenshot' | 'type' | 'wait' | string;
  description: string;
  timestamp: string;
  screenshot?: string;
}

export interface RunFeedProps {
  steps: AgentStep[];
  isLoading?: boolean;
}

const stepTypeIcon: Record<string, string> = {
  navigate: '🌐',
  click: '🖱️',
  screenshot: '📸',
  type: '⌨️',
  wait: '⏳',
};

export function RunFeed({ steps, isLoading = false }: RunFeedProps) {
  if (isLoading) {
    return (
      <div data-testid="run-feed-loading" className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div data-testid="run-feed-empty" className="text-text-secondary text-sm py-4">
        No steps yet. The agent will report actions here as it runs.
      </div>
    );
  }

  return (
    <div data-testid="run-feed" className="flex flex-col gap-0">
      {steps.map((step, index) => (
        <div
          key={index}
          data-testid={`run-feed-step-${index}`}
          className="flex gap-4 relative"
        >
          {/* Timeline line */}
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 rounded-full bg-bg-elevated border border-border-default flex items-center justify-center text-sm flex-shrink-0 z-10">
              {stepTypeIcon[step.type] ?? '▶'}
            </div>
            {index < steps.length - 1 && (
              <div className="w-px flex-1 bg-border-default min-h-[16px]" />
            )}
          </div>

          {/* Step content */}
          <div className="pb-4 flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                data-testid={`step-type-${index}`}
                className="text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                {step.type}
              </span>
              <span className="text-xs text-text-secondary">
                {new Date(step.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <p
              data-testid={`step-description-${index}`}
              className="text-sm text-text-primary"
            >
              {step.description}
            </p>
            {step.screenshot && (
              <img
                data-testid={`step-screenshot-${index}`}
                src={step.screenshot}
                alt={`Screenshot for step ${index + 1}`}
                className="mt-2 rounded border border-border-default max-w-sm"
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
