import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Badge, Button, Check, RefreshCw, X, cn } from '@automate/ui';
import { Route as dashboardRoute } from '../dashboard.js';
import {
  Kpi,
  PageFrame,
  PageHeader,
  Panel,
  PagerControls,
  Quiet,
  StatusDot,
  usePager,
} from '../../components/kit.js';
import { ProjectGate } from '../../components/ProjectGate.js';
import { useResource } from '../../hooks/useResource.js';
import { createQaClient, type QaClient } from '../../lib/qa-client.js';
import type { CapabilityCoverage, RegisteredProject, RepoScan } from '../../lib/qa.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/health',
  component: () => <HealthPage qa={createQaClient()} />,
});

/**
 * Repository health: which QA capabilities the repository has, and what its reports say.
 *
 * ## Two different questions, side by side
 *
 * The capability grid answers "is there a tool for this" — a unit runner, a secret
 * scanner, a mutation suite. The reports answer "what did the tools say when they last
 * ran". A repository can have a coverage tool and a 40% coverage report, and both halves
 * are needed to see that; neither one implies the other.
 */
export const CAPABILITY_LABELS: Record<CapabilityCoverage['capability'], string> = {
  unit: 'Unit tests',
  integration: 'Integration',
  e2e: 'End-to-end',
  coverage: 'Coverage',
  'static-analysis': 'Static analysis',
  types: 'Type checking',
  formatting: 'Formatting',
  sast: 'SAST',
  secrets: 'Secret scanning',
  dependencies: 'Dependency audit',
  performance: 'Performance',
  accessibility: 'Accessibility',
  mutation: 'Mutation',
  contract: 'Contract',
  visual: 'Visual regression',
  ci: 'CI gates',
};

export function HealthPage({ qa }: { qa: QaClient }): React.ReactElement {
  return (
    <ProjectGate qa={qa} title="Health">
      {(project, switcher) => <HealthBody qa={qa} project={project} switcher={switcher} />}
    </ProjectGate>
  );
}

function HealthBody({
  qa,
  project,
  switcher,
}: {
  qa: QaClient;
  project: RegisteredProject;
  switcher: React.ReactNode;
}): React.ReactElement {
  const [generation, setGeneration] = React.useState(0);
  const scan = useResource<RepoScan>(
    () => qa.getScan(project.id, generation > 0),
    [qa, project.id, generation],
  );
  return (
    <PageFrame data-testid="health-page">
      <PageHeader
        title="Health"
        subtitle={`What ${project.name} has for QA, and what its reports say`}
        actions={
          <>
            {switcher}
            <Button
              variant="outline"
              data-testid="health-rescan"
              onClick={() => setGeneration((value) => value + 1)}
              className="min-h-11"
            >
              <RefreshCw size={14} aria-hidden="true" />
              Rescan
            </Button>
          </>
        }
      />
      {scan.status === 'ready' ? (
        <HealthGrid scan={scan.value} />
      ) : scan.status === 'error' ? (
        <Quiet role="alert" data-testid="health-error">
          The repository could not be scanned: {scan.message}
        </Quiet>
      ) : (
        <Quiet data-testid="health-loading">Scanning {project.name}…</Quiet>
      )}
    </PageFrame>
  );
}

function HealthGrid({ scan }: { scan: RepoScan }): React.ReactElement {
  const covered = scan.capabilities.filter((entry) => entry.covered).length;
  const ratio = scan.sourceFiles === 0 ? null : scan.testFiles / scan.sourceFiles;
  const reports = usePager(scan.reports, 6);
  return (
    <>
      <section
        aria-label="Repository figures"
        className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
      >
        <Kpi
          data-testid="health-maturity"
          label="QA maturity"
          value={String(scan.maturity)}
          unit="%"
          footer="weighted by capability"
        />
        <Kpi
          label="Capabilities"
          value={String(covered)}
          unit={`/ ${String(scan.capabilities.length)}`}
          footer={`${String(scan.capabilities.length - covered)} missing`}
        />
        <Kpi
          label="Test files"
          value={String(scan.testFiles)}
          footer={`${String(scan.sourceFiles)} source files`}
        />
        <Kpi
          label="Test ratio"
          value={ratio === null ? '—' : ratio.toFixed(2)}
          footer="test files per source file"
        />
        <Kpi
          label="Tools"
          value={String(scan.tools.length)}
          footer={`${String(scan.detected.length)} recognised`}
        />
        <Kpi
          label="Reports"
          value={String(scan.reports.length)}
          footer={scan.ecosystems.join(' · ') || 'no ecosystem'}
        />
      </section>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="QA capabilities" data-testid="health-capabilities">
          <ul className="grid min-h-0 flex-1 grid-cols-2 gap-2 md:grid-cols-4">
            {scan.capabilities.map((entry) => (
              <li
                key={entry.capability}
                data-testid={`capability-${entry.capability}`}
                data-covered={entry.covered}
                className={cn(
                  'flex min-w-0 flex-col gap-1 rounded-xl border p-3',
                  entry.covered ? 'border-border' : 'border-dashed border-warning',
                )}
              >
                <span className="flex items-center gap-1.5 text-sm">
                  {entry.covered ? (
                    <Check size={14} aria-hidden="true" className="shrink-0 text-success" />
                  ) : (
                    <X size={14} aria-hidden="true" className="shrink-0 text-warning" />
                  )}
                  <span className="truncate">{CAPABILITY_LABELS[entry.capability]}</span>
                  <span className="sr-only">{entry.covered ? ', covered' : ', missing'}</span>
                </span>
                <span
                  className="mt-1 truncate text-xs text-fg-muted"
                  title={entry.providers.join(', ')}
                >
                  {entry.covered
                    ? entry.providers.slice(0, 2).join(', ')
                    : 'Nothing covers this yet'}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Reports on disk" data-testid="health-reports">
          {reports.items.length === 0 ? (
            <Quiet>
              No coverage, JUnit, Playwright, ESLint, SARIF, Gitleaks or k6 report was found.
            </Quiet>
          ) : (
            <ul className="min-h-0 flex-1 space-y-2">
              {reports.items.map((report) => (
                <li key={report.path} data-testid={`report-${report.path}`} className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusDot status={report.status} />
                    <span className="truncate text-sm">{report.headline}</span>
                    <Badge variant="outline" className="ml-auto shrink-0">
                      {report.kind}
                    </Badge>
                  </div>
                  <div className="truncate pl-4 font-mono text-xs text-fg-muted">{report.path}</div>
                </li>
              ))}
            </ul>
          )}
          <PagerControls pager={reports} label="report" />
        </Panel>
      </div>
    </>
  );
}
