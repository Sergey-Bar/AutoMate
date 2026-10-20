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
  children: (project: RegisteredProject) => React.ReactNode;
}): React.ReactElement {
  const registry = useResource<RegisteredProject[]>(() => qa.listProjects(), [qa]);
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
          data-testid="project-gate-error"
          title="The project registry is unavailable"
          description={registry.message}
        />
      </PageFrame>
    );
  }
  const subject =
    projectId === undefined
      ? registry.value[0]
      : registry.value.find((project) => project.id === projectId);
  if (subject === undefined) return <Onboarding title={title} />;
  return <>{children(subject)}</>;
}

function Onboarding({ title }: { title: string }): React.ReactElement {
  return (
    <PageFrame data-testid="onboarding">
      <PageHeader title={title} subtitle="No project is registered yet." />
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-measure space-y-3 rounded-2xl border border-border bg-surface-raised p-8">
          <h2 className="text-xl font-light">Point Automate at a repository</h2>
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
