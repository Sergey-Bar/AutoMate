import React from 'react';
import { EmptyState } from '@automate/ui';
import { useResource } from '../hooks/useResource.js';
import type { QaClient } from '../lib/qa-client.js';
import type { RegisteredProject } from '../lib/qa.js';
import { PageFrame, PageHeader, Quiet } from './kit.js';

/**
 * Reads the registry once and hands each project-scoped screen its subject.
 *
 * ## Onboarding is a screen, not an empty grid
 *
 * The dashboard, the runner, the health page and the toolbox all report on one
 * repository. With none registered there is nothing for any of them to say, and an empty
 * grid cannot distinguish "no project yet" from "the API is broken" — the two need
 * opposite responses. So the four screens share this gate rather than each deciding what
 * an empty registry looks like, and the onboarding copy is written once.
 */
export function ProjectGate({
  qa,
  title,
  projectId,
  children,
}: {
  qa: QaClient;
  /** The screen's own name, so a loading or empty state still has an `h1`. */
  title: string;
  projectId?: string;
  /**
   * The screen, given its subject and the switcher to place in its header. The switcher is
   * `null` with one project registered, because a choice of one is not a control.
   */
  children: (project: RegisteredProject, switcher: React.ReactNode) => React.ReactNode;
}): React.ReactElement {
  const registry = useResource<RegisteredProject[]>(() => qa.listProjects(), [qa]);
  const [chosen, choose] = React.useState<string | null>(() => readChoice());
  if (registry.status === 'loading') {
    return (
      <PageFrame data-testid="project-gate-loading">
        <PageHeader title={title} />
        <Quiet>Reading the registry…</Quiet>
      </PageFrame>
    );
  }
  if (registry.status === 'error') {
    return (
      <PageFrame>
        <PageHeader title={title} />
        <EmptyState
          headingLevel={2}
          data-testid="project-gate-error"
          title="The project registry is unavailable"
          description={registry.message}
        />
      </PageFrame>
    );
  }
  const projects = registry.value;
  const subject =
    projectId === undefined
      ? (projects.find((project) => project.id === chosen) ?? projects[0])
      : projects.find((project) => project.id === projectId);
  if (subject === undefined) return <Onboarding title={title} />;
  const switcher =
    projectId === undefined && projects.length > 1 ? (
      <label className="flex items-center gap-2 text-sm text-fg-muted">
        <span className="sr-only">Project</span>
        <select
          data-testid="project-switcher"
          value={subject.id}
          onChange={(event) => {
            writeChoice(event.target.value);
            choose(event.target.value);
          }}
          className="min-h-11 max-w-56 truncate rounded-lg border border-border bg-surface-raised px-3 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
    ) : null;
  return <>{children(subject, switcher)}</>;
}

/**
 * The chosen project, shared by every project screen and kept across reloads.
 *
 * `localStorage` rather than the URL because the choice is the reader's, not the page's:
 * moving from the dashboard to the runner should stay on the repository they picked.
 * A stored id that is no longer registered falls back to the first project.
 */
const CHOICE_KEY = 'automate-project';

function readChoice(): string | null {
  try {
    return localStorage.getItem(CHOICE_KEY);
  } catch {
    return null;
  }
}

function writeChoice(projectId: string): void {
  try {
    localStorage.setItem(CHOICE_KEY, projectId);
  } catch {
    // A storage that refuses writes leaves the choice for this page only, which is still a choice.
  }
}

function Onboarding({ title }: { title: string }): React.ReactElement {
  return (
    <PageFrame data-testid="onboarding">
      <PageHeader title={title} subtitle="No project is registered yet." />
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-measure space-y-3 rounded-xl border border-border bg-surface-raised p-8">
          <h2 className="text-xl font-semibold">Point Automate at a repository</h2>
          <p className="max-w-measure text-pretty text-sm text-fg-muted">
            Set <span className="font-mono">AUTOMATE_PROJECT_ROOT</span> to the checkout you want
            analysed and restart the API. It registers that folder at boot, scans every tool and
            report in it, and this screen fills in. This is an empty install, not a failure.
          </p>
          <p className="max-w-measure text-pretty text-sm text-fg-muted">
            Or register one by hand with <span className="font-mono">POST /api/v1/projects</span>{' '}
            and a <span className="font-mono">name</span>, <span className="font-mono">slug</span>{' '}
            and <span className="font-mono">repoPath</span>.
          </p>
        </div>
      </div>
    </PageFrame>
  );
}
