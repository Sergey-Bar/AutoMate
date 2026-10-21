import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { PageFrame, PageHeader, Quiet } from '../../components/kit.js';
import { ProjectGate } from '../../components/ProjectGate.js';
import { RepoMap } from '../../components/map/RepoMap.js';
import { read } from '../../components/Dashboard.js';
import { useResource } from '../../hooks/useResource.js';
import { createQaClient, type QaClient } from '../../lib/qa-client.js';
import type { QaScore, RegisteredProject, ReleaseReadinessCard, RepoScan } from '../../lib/qa.js';
import {
  buildRepoMap,
  compactMapSearch,
  parseMapSearch,
  type MapSearch,
  type MapSearchParams,
} from '../../lib/repo-map.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/map',
  // The view, the open node and the blocking path live in the URL, so a link reopens the
  // same picture. Only what differs from the default is written, so a plain visit stays
  // `/dashboard/map`; anything unreadable is dropped rather than failing the page.
  validateSearch: (search: Record<string, unknown>): MapSearchParams =>
    compactMapSearch(parseMapSearch(search)),
  component: MapRoute,
});

function MapRoute(): React.ReactElement {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qa = React.useMemo(() => createQaClient(), []);
  return (
    <MapPage
      qa={qa}
      state={parseMapSearch(search)}
      onStateChange={(next) => void navigate({ search: compactMapSearch(next), replace: true })}
    />
  );
}

export function MapPage({
  qa,
  state,
  onStateChange,
}: {
  qa: QaClient;
  state: MapSearch;
  onStateChange: (next: MapSearch) => void;
}): React.ReactElement {
  return (
    <ProjectGate qa={qa} title="Map">
      {(project, switcher) => (
        <MapBody
          qa={qa}
          project={project}
          switcher={switcher}
          state={state}
          onStateChange={onStateChange}
        />
      )}
    </ProjectGate>
  );
}

interface Reads {
  scan: RepoScan;
  score: QaScore | null;
  readiness: ReleaseReadinessCard | null;
  failures: string[];
}

/**
 * The scan is required — without it there is nothing to draw. The score and the readiness
 * card are not: a map without them still shows the repository, and every node they would
 * have coloured says "not measured" rather than passing.
 */
async function loadReads(qa: QaClient, projectId: string): Promise<Reads> {
  const scan = await qa.getScan(projectId);
  const [score, readiness] = await Promise.allSettled([
    qa.getScore(projectId),
    qa.getReadiness(projectId, 7),
  ]);
  const scoreRead = read(score);
  const readinessRead = read(readiness);
  return {
    scan,
    score: scoreRead.value,
    readiness: readinessRead.value,
    failures: [
      scoreRead.failure === null ? null : `score: ${scoreRead.failure}`,
      readinessRead.failure === null ? null : `readiness: ${readinessRead.failure}`,
    ].filter((entry): entry is string => entry !== null),
  };
}

function MapBody({
  qa,
  project,
  switcher,
  state,
  onStateChange,
}: {
  qa: QaClient;
  project: RegisteredProject;
  switcher: React.ReactNode;
  state: MapSearch;
  onStateChange: (next: MapSearch) => void;
}): React.ReactElement {
  const reads = useResource<Reads>(() => loadReads(qa, project.id), [qa, project.id]);
  const map = React.useMemo(
    () =>
      reads.status === 'ready'
        ? buildRepoMap(
            {
              projectName: project.name,
              scan: reads.value.scan,
              score: reads.value.score,
              readiness: reads.value.readiness,
            },
            state.view,
          )
        : null,
    [reads, project.name, state.view],
  );
  return (
    <PageFrame data-testid="map-page">
      <PageHeader
        title="Map"
        subtitle={
          state.view === 'flow'
            ? `How ${project.name} gets from code to a release verdict`
            : `Where in ${project.name} quality is strong and weak`
        }
        actions={switcher}
      />
      {reads.status === 'error' ? (
        <Quiet role="alert" data-testid="map-error">
          The repository could not be scanned: {reads.message}
        </Quiet>
      ) : reads.status === 'loading' || map === null ? (
        <Quiet data-testid="map-loading">Mapping {project.name}…</Quiet>
      ) : (
        <>
          {reads.value.failures.length > 0 ? (
            <p
              role="status"
              data-testid="map-partial"
              className="max-w-measure shrink-0 text-xs text-warning"
            >
              {reads.value.failures.join(' · ')}. Nodes those reads would colour are shown as not
              measured.
            </p>
          ) : null}
          <RepoMap map={map} state={state} onStateChange={onStateChange} />
        </>
      )}
    </PageFrame>
  );
}
