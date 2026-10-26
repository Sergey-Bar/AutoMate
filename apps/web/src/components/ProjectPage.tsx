import React from 'react';
import { Button, Skeleton } from '@automate/ui';
import type { Resource } from '../hooks/useResource.js';
import type { HealthClient, WhoAmI } from '../lib/health-client.js';
import type { QaClient } from '../lib/qa-client.js';
import type { RegisteredProject } from '../lib/qa.js';
import { AccessGate } from './Access.js';
import { Quiet } from './kit.js';
import { ProjectGate } from './ProjectGate.js';

/**
 * A per-project screen: who is signed in, which project, and the switcher for its header.
 *
 * The access gate first, because the role decides which actions the screen offers; the
 * project gate second, so an empty registry is onboarding rather than an empty grid. A link
 * that names a project (`?project=`) pins the screen to it.
 */
export interface ProjectContext {
  who: WhoAmI;
  project: RegisteredProject;
  switcher: React.ReactNode;
}

export function ProjectPage({
  qa,
  health,
  title,
  projectId,
  children,
}: {
  qa: QaClient;
  health: HealthClient;
  title: string;
  projectId?: string | undefined;
  children: (context: ProjectContext) => React.ReactNode;
}): React.ReactElement {
  return (
    <AccessGate health={health}>
      {(who) => (
        <ProjectGate qa={qa} title={title} {...(projectId === undefined ? {} : { projectId })}>
          {(project, switcher) => children({ who, project, switcher })}
        </ProjectGate>
      )}
    </AccessGate>
  );
}

/**
 * One resource's three states inside a panel: reading, the server's own sentence, or the
 * content. A failure is never drawn as "nothing here".
 */
export function Loaded<T>({
  resource,
  label,
  children,
  testId,
}: {
  resource: Resource<T>;
  label: string;
  children: (value: T) => React.ReactNode;
  testId?: string;
}): React.ReactElement {
  if (resource.status === 'loading') {
    return (
      <div data-testid={testId === undefined ? undefined : `${testId}-loading`} aria-busy="true">
        <span className="sr-only">{`Reading ${label}…`}</span>
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (resource.status === 'error') {
    return (
      <Quiet role="alert" data-testid={testId === undefined ? undefined : `${testId}-error`}>
        {`Could not read ${label}: ${resource.message}`}
      </Quiet>
    );
  }
  return <>{children(resource.value)}</>;
}

/** The `?project=` a link to a per-project screen may carry. */
export function projectSearch(search: Record<string, unknown>): { project?: string } {
  const project = search['project'];
  return typeof project === 'string' && project.length > 0 ? { project } : {};
}

/** A link to a per-project screen, pinned to one project. */
export function projectLink(path: string, projectId: string): string {
  return `${path}?project=${encodeURIComponent(projectId)}`;
}

/** "26–50 of 120", and the two buttons that move a server-paged list by one page. */
export function PageControls({
  offset,
  shown,
  total,
  size,
  onOffset,
  testId,
}: {
  offset: number;
  shown: number;
  total: number;
  size: number;
  onOffset: (offset: number) => void;
  testId: string;
}): React.ReactElement {
  return (
    <div className="mt-2 flex items-center justify-between text-xs text-fg-muted">
      <span data-testid={testId} className="tabular-nums">
        {`${String(offset + 1)}–${String(offset + shown)} of ${String(total)}`}
      </span>
      <span className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={offset === 0}
          onClick={() => onOffset(Math.max(0, offset - size))}
        >
          Previous
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={offset + size >= total}
          onClick={() => onOffset(offset + size)}
        >
          Next
        </Button>
      </span>
    </div>
  );
}
