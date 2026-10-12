import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Badge, Card, EmptyState, Skeleton, StatCard } from '@automate/ui';
import { Route as dashboardRoute } from '../dashboard.js';
import { useResource } from '../../hooks/useResource.js';
import {
  QA_TOOLS_REGISTRY,
  ESSENTIAL_TOOL_IDS,
  CATEGORY_LABELS,
} from '@automate/projects/tool-catalog';
import { analyzeStack, TIER_LABELS, type ToolDetection } from '../../lib/analysis.js';
import { defaultApiClient, type ApiClient } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/tools',
  component: () => <QaToolsPage />,
});

/**
 * The QA stack, for one project, from the repository rather than from an assumption.
 *
 * ## What changed, and why the old screen could not be fixed
 *
 * The previous tools page rendered the registry beside a hand-written ten-path
 * list the client carried — so "your stack" was whatever the browser imagined the
 * repository to be. There is no way to fix that in the browser: a web page cannot
 * list a directory. `GET /api/v1/projects/:id/toolchain` reads the repository
 * through the injectable `RepositoryView` and answers per tool with the path or
 * the manifest entry that proved it, and this screen formats that answer.
 *
 * **Every tool here carries its evidence, and an undetected one carries none.**
 * The coverage figure is a join over those detections, so a row nobody can check
 * would be a number nobody can trust — which is the rule `analyzeStack` was
 * rewritten to enforce.
 */
export function QaToolsPage({ api, projectId }: { api?: ApiClient; projectId?: string }) {
  const registry = useResource<ToolDetection[]>(
    (signal) =>
      projectId === undefined
        ? Promise.resolve([])
        : getToolchain(api ?? defaultApiClient, projectId, signal),
    [api, projectId],
  );

  const tools = QA_TOOLS_REGISTRY;
  const detections = registry.status === 'ready' ? registry.value : [];
  const { statuses, coverage } = React.useMemo(
    () => analyzeStack(tools, detections),
    [tools, detections],
  );
  const detected = statuses.filter((status) => status.detected);
  const missing = statuses.filter((status) => !status.detected);
  const missingEssentials = missing.filter((status) => ESSENTIAL_TOOL_IDS.includes(status.tool.id));

  return (
    <div className="p-4 sm:p-6 lg:p-8" data-testid="tools-page">
      {/*
        One h1, and only one — `Composition.test.tsx` fails a screen whose headings
        begin at h2, because a heading list with no name for the screen has no name
        for the screen. Both states therefore render inside this shell rather than
        each bringing their own title.
      */}
      <h1 className="mb-1 text-balance text-3xl font-bold tracking-tight text-text-primary">
        QA Tools
      </h1>
      <p className="mb-8 max-w-measure text-pretty text-sm text-fg-muted">
        What this repository actually runs, read from its manifests and config files. Every detected
        tool names the file that proved it; a tool with no evidence is a tool that was not found,
        and the API says so rather than guessing.
      </p>

      {projectId === undefined ? (
        <EmptyState
          data-testid="tools-no-project"
          title="No project selected"
          description="Pick a project on the cockpit first — the stack is read from its repository."
          /*
            The next step, as a link rather than a sentence.

            **An empty state that says what to do without linking to it is a
            state the reader leaves.** This one names the only place a project is
            chosen, and `Accessibility.test.tsx`'s sweep puts the screen in exactly
            this state — which is also how the state was caught having no actionable
            control at all.
          */
          action={
            <a
              href="/dashboard"
              className="rounded-md border border-border px-3 py-2 text-sm text-fg transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-border-focus focus-visible:outline-offset-2"
            >
              Choose a project on the cockpit
            </a>
          }
        />
      ) : (
        <>
          {/*
            The three figures, as `StatCard` — the primitive the registry screen was
            not using, and the reason its figures shifted sideways as they updated
            (DESIGN-4). `tabular-nums` comes from the component rather than from each
            call site remembering to add it.
          */}
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              title="Tools in registry"
              value={tools.length}
              description="Across every category, free and paid alike"
              data-testid="tools-total"
            />
            <StatCard
              title="Detected in this project"
              value={detected.length}
              description={`${coverage}% of the registry, joined against the probe`}
              data-testid="tools-detected"
            />
            <StatCard
              title="Missing essentials"
              value={missingEssentials.length}
              description={
                missingEssentials.length === 0
                  ? 'Nothing the registry considers essential is absent'
                  : missingEssentials.map((status) => status.tool.name).join(', ')
              }
              data-testid="tools-missing"
            />
          </div>

          {registry.status === 'loading' && (
            <Skeleton className="h-32 w-full" data-testid="tools-loading" />
          )}
          {registry.status === 'error' && (
            <EmptyState
              data-testid="tools-error"
              title="The probe did not answer"
              description={registry.message}
            />
          )}

          {registry.status !== 'loading' && registry.status !== 'error' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ToolGroup
                title="Detected"
                description="Each row names the file that proved it."
                statuses={detected}
                testId="tools-detected-list"
              />
              <ToolGroup
                title="Not found"
                description="No manifest entry and no config file named these."
                statuses={missing}
                testId="tools-missing-list"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A card per group, with the registry's one-line description and the tier badge. */
function ToolGroup({
  title,
  description,
  statuses,
  testId,
}: {
  title: string;
  description: string;
  statuses: ReturnType<typeof analyzeStack>['statuses'];
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <div className="p-5">
        <h2 className="text-lg font-semibold tracking-tight text-text-primary">{title}</h2>
        <p className="mt-1 max-w-measure text-pretty text-sm text-fg-muted">{description}</p>
        <ul className="mt-4 flex flex-col gap-3">
          {statuses.length === 0 && (
            <li className="text-sm text-fg-muted" data-testid={`${testId}-empty`}>
              Nothing in this group.
            </li>
          )}
          {statuses.map((status) => (
            <li
              key={status.tool.id}
              data-testid={`tool-${status.tool.id}`}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3 last:border-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">{status.tool.name}</p>
                <p className="max-w-measure text-pretty text-xs text-fg-muted">
                  {status.tool.description}
                </p>
                {status.evidence !== null && (
                  <p
                    className="mt-1 font-mono text-xs text-fg-muted"
                    data-testid={`evidence-${status.tool.id}`}
                  >
                    {status.evidence}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-fg-muted">
                  {CATEGORY_LABELS[status.tool.category]}
                </span>
                <Badge variant={status.tool.tier === 'paid' ? 'warning' : 'default'}>
                  {TIER_LABELS[status.tool.tier]}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** The probe's answer for one project, as the client's typed shape. */
async function getToolchain(
  api: ApiClient,
  projectId: string,
  signal: AbortSignal,
): Promise<ToolDetection[]> {
  const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/toolchain`, {
    signal,
  });
  if (!response.ok) {
    throw new Error(`The toolchain probe answered ${response.status}`);
  }
  const body = (await response.json()) as { detections: ToolDetection[] };
  return body.detections;
}
