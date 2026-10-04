import React from 'react';
import { createRoute } from '@tanstack/react-router';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@automate/ui';
import { Route as dashboardRoute } from '../dashboard.js';
import { createQaClient, type QaClient } from '../../lib/qa-client.js';
import type {
  QaFlakyResponse,
  QaGapsResponse,
  QaHollowResponse,
  QaStructureResponse,
} from '../../lib/qa.js';
import { useResource } from '../../hooks/useResource.js';

/**
 * The four deep-dive screens, and the state machine they share.
 *
 * ## The client is a **prop**, following every other dashboard route here
 *
 * A module singleton would have to be replaced before the module loaded, which is a
 * test that passes or fails on import order. The route wrapper is the only place
 * that calls `createQaClient()`.
 */

export interface ScreenProps {
  api: QaClient;
  projectId: string;
}

/** Loading, error and empty are the same three states on every screen. */
function frame<T>(
  resource:
    | { status: 'loading' }
    | { status: 'ready'; value: T }
    | { status: 'error'; message: string },
  title: string,
  children: (value: T) => React.ReactElement,
): React.ReactElement {
  if (resource.status === 'loading') return <Skeleton />;
  if (resource.status === 'error') {
    // The server's own words. A screen that rendered "something went wrong" would
    // hide the only sentence that would have helped.
    return <EmptyState title={title} description={resource.message} />;
  }
  return children(resource.value);
}

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/gaps/$projectId',
  component: () => {
    const { projectId } = Route.useParams();
    return <GapsPage api={createQaClient()} projectId={projectId} />;
  },
});

/**
 * The gap queue.
 *
 * **Not re-sorted here.** The server ranked by what closing each cell is worth to the
 * total, and a client that re-ranked would be a second authority about the same
 * number. The order the response arrived in is the order the reader sees, and the
 * header says so.
 */
export function GapsPage({ api, projectId }: ScreenProps): React.ReactElement {
  const resource = useResource<QaGapsResponse>(() => api.getGaps(projectId), [api, projectId]);
  return frame(resource, 'Could not load the gaps', (response) =>
    response.gaps.length === 0 ? (
      <EmptyState title="Nothing to fix" description="Every cell is either scored or marked n/a." />
    ) : (
      <section aria-label="Automation gaps">
        <Card>
          <CardHeader>
            <CardTitle>Automation gaps</CardTitle>
            <CardDescription>
              {`Best value first, as ranked by the score. Capped by ${response.cappedBy}.`}
            </CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cell</TableHead>
                <TableHead>Now</TableHead>
                <TableHead>What would close it</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {response.gaps.map((gap) => (
                <TableRow key={gap.cell}>
                  <TableCell>{gap.cell}</TableCell>
                  <TableCell>{gap.current.toFixed(2)}</TableCell>
                  <TableCell>{gap.cheapestClosure}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>
    ),
  );
}

/**
 * The hollow-test register.
 *
 * **Rendered as a list of test identities, not as a count.** "3 hollow tests" is a
 * number the reader cannot act on; `hollow-1`, `hollow-2` are rows they can go and
 * look at, and the whole point of naming them is that a green suite doing nothing is
 * otherwise invisible.
 *
 * An **empty** register gets no reassuring message, deliberately: "no hollow tests
 * found" and "no evidence collected" are different claims, and only one of them is
 * what an empty list means.
 */
export function HollowPage({ api, projectId }: ScreenProps): React.ReactElement {
  const resource = useResource<QaHollowResponse>(() => api.getHollow(projectId), [api, projectId]);
  return frame(resource, 'Could not load hollow tests', (response) => (
    <section aria-label="Hollow tests">
      <Card>
        <CardHeader>
          <CardTitle>Hollow tests</CardTitle>
          <CardDescription>
            Green, and contributing nothing. A hollow test raises the pass rate and lowers no other
            number.
          </CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cell</TableHead>
              <TableHead>Test fingerprints</TableHead>
              <TableHead>Signal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {response.cells.map((cell) => (
              <TableRow key={cell.cell}>
                <TableCell>{cell.cell}</TableCell>
                <TableCell>{cell.hollowFingerprints.join(', ')}</TableCell>
                <TableCell>{cell.signal.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  ));
}

/** The flaky register, with the flake rate beside the fingerprints it describes. */
export function FlakyPage({ api, projectId }: ScreenProps): React.ReactElement {
  const resource = useResource<QaFlakyResponse>(() => api.getFlaky(projectId), [api, projectId]);
  return frame(resource, 'Could not load flaky tests', (response) => (
    <section aria-label="Flaky tests">
      <Card>
        <CardHeader>
          <CardTitle>Flaky tests</CardTitle>
          <CardDescription>
            Same fingerprint, same commit, different outcome. Weak evidence never quarantines a test
            on its own.
          </CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cell</TableHead>
              <TableHead>Fingerprints</TableHead>
              <TableHead>Flake rate</TableHead>
              <TableHead>Stability</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {response.cells.map((cell) => (
              <TableRow key={cell.cell}>
                <TableCell>{cell.cell}</TableCell>
                <TableCell>{cell.flakyFingerprints.join(', ')}</TableCell>
                <TableCell>{cell.flakeRate.toFixed(2)}</TableCell>
                <TableCell>{cell.stability.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  ));
}

/**
 * The structural findings.
 *
 * **Rendered beside the score, never inside it.** None of these changes the total —
 * a cell that is present, deep, stable and non-hollow has earned its number by the
 * formula, and discounting it silently would be a rule nobody could see. They are
 * reported and ranked by impact, which is a different thing and labelled as one.
 */
export function StructurePage({ api, projectId }: ScreenProps): React.ReactElement {
  const resource = useResource<QaStructureResponse>(
    () => api.getStructure(projectId),
    [api, projectId],
  );
  return frame(resource, 'Could not load structural findings', (response) =>
    response.findings.length === 0 ? (
      <EmptyState
        title="No structural findings"
        description="No cell is present-but-empty, dominant, or single-layer."
      />
    ) : (
      <section aria-label="Structural findings">
        <Card>
          <CardHeader>
            <CardTitle>Structural findings</CardTitle>
            <CardDescription>
              Reported, never scored. Each names the cells it came from.
            </CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Finding</TableHead>
                <TableHead>Statement</TableHead>
                <TableHead>Impact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {response.findings.map((finding) => (
                <TableRow key={`${finding.kind}:${finding.cells.join(',')}`}>
                  <TableCell>{finding.kind}</TableCell>
                  <TableCell>{finding.statement}</TableCell>
                  <TableCell>{finding.impact.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>
    ),
  );
}

/**
 * The remaining three, as routes.
 *
 * **Four routes rather than one `/qa/deep-dive` with a tab bar.** They are read for
 * different decisions, and a URL that names the view is a URL a reader can send to a
 * colleague. A tab bar hides which one they are looking at.
 */
export const GapsRoute = Route;
export const HollowRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/hollow/$projectId',
  component: () => {
    const { projectId } = HollowRoute.useParams();
    return <HollowPage api={createQaClient()} projectId={projectId} />;
  },
});
export const FlakyRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/flaky/$projectId',
  component: () => {
    const { projectId } = FlakyRoute.useParams();
    return <FlakyPage api={createQaClient()} projectId={projectId} />;
  },
});
export const StructureRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/structure/$projectId',
  component: () => {
    const { projectId } = StructureRoute.useParams();
    return <StructurePage api={createQaClient()} projectId={projectId} />;
  },
});
