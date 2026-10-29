import React from 'react';
import { BookOpen, ChevronRight } from '@automate/ui';
import { routeFor } from '../route-manifest.js';
import { pageGuidance } from '../page-guidance.js';

export function PageGuide({ pathname }: { pathname: string }): React.ReactElement | null {
  const route = routeFor(pathname);
  if (!route) return null;
  const guide = pageGuidance[route.id];
  return (
    <details
      key={route.id}
      className="mb-3 shrink-0 rounded-lg border border-border bg-surface"
      data-chrome="secondary"
    >
      <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus">
        <span className="ml-2 inline-flex items-center gap-2">
          <BookOpen size={16} aria-hidden="true" />
          <strong>How to use {route.label}</strong>
          <span className="hidden text-fg-muted sm:inline">Start here</span>
        </span>
      </summary>
      <div className="border-t border-border px-4 py-4">
        <p className="max-w-measure text-sm leading-relaxed text-fg-muted">{guide.purpose}</p>
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {guide.steps.map((step, index) => (
            <li
              key={step}
              className="flex gap-3 rounded-md border border-border bg-surface-sunken p-3"
            >
              <span className="font-mono text-sm text-fg-muted">0{index + 1}</span>
              <p className="flex-1 text-sm leading-relaxed">{step}</p>
              {index < 2 ? (
                <ChevronRight size={16} className="shrink-0 text-fg-muted" aria-hidden="true" />
              ) : null}
            </li>
          ))}
        </ol>
        <p className="mt-4 max-w-measure text-sm leading-relaxed text-fg-muted">
          <strong className="text-fg">Keep in mind: </strong>
          {guide.remember}
        </p>
      </div>
    </details>
  );
}
