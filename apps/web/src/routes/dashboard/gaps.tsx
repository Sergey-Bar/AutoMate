import React from 'react';
import { createRoute } from '@tanstack/react-router';
import {
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
import { useResource, type Resource } from '../../hooks/useResource.js';
import { PageFrame, PageHeader, Paged, Panel } from '../../components/kit.js';

/**
 * The four deep-dive screens, and the frame they share.
 *
 * ## The client is a **prop**, following every other dashboard route here
 *
 * A module singleton would have to be replaced before the module loaded, which is a
 * test that passes or fails on import order. The route wrapper is the only place
 * that calls `createQaClient()`.
 *
 * ## Fitted, not scrolled
 *
 * Each screen is a page frame with one panel whose table is paged, so a register of two
 * hundred fingerprints is read a page at a time rather than scrolled past.
 */

export interface ScreenProps {
  api: QaClient;
  projectId: string;
}

/** The header and panel chrome above a deep-dive table; the rows fill what is left. */
const DEEP_DIVE_RESERVED = 360;

/** Loading, error and ready are the same three states on every screen. */
function frame<T>(
  resource: Resource<T>,
  title: string,
  failure: string,
  children: (value: T) => React.ReactElement,
): React.ReactElement {
  return (
    <PageFrame>
      {resource.status === 'ready' ? (
        children(resource.value)
      ) : (
        <>
          <PageHeader title={title} />
          {resource.status === 'loading' ? (
            <Skeleton />
          ) : (
            // The server's own words. A screen that rendered "something went wrong" would
            // hide the only sentence that would have helped.
            <EmptyState headingLevel={2} title={failure} description={resource.message} />
          )}
        </>
      )}
    </PageFrame>
  );
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
  return frame(resource, 'Automation gaps', 'Could not load the gaps', (response) => (
    <>
      <PageHeader
        title="Automation gaps"
        subtitle={`Best value first, as ranked by the score. Capped by ${response.cappedBy}.`}
      />
      {response.gaps.length === 0 ? (
        <EmptyState
          headingLevel={2}
          title="Nothing to fix"
          description="Every cell is either scored or marked n/a."
        />
      ) : (
        <Panel title="Gaps" className="flex-1">
          <Paged items={response.gaps} reservedPx={DEEP_DIVE_RESERVED} label="gap">
            {(page) => (
              <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                <TableHeader>
                  <TableRow>
                    <TableHead>Cell</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Now</TableHead>
                    <TableHead className="text-right">Worth</TableHead>
                    <TableHead>What would close it</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.map((gap) => (
                    <TableRow key={gap.cell}>
                      <TableCell className="font-mono">{gap.cell}</TableCell>
                      <TableCell numeric className="hidden tabular-nums sm:table-cell">
                        {gap.current.toFixed(2)}
                      </TableCell>
                      <TableCell numeric>{`+${(gap.potential * 100).toFixed(0)} pts`}</TableCell>
                      <TableCell className="w-full max-w-0 truncate" title={gap.cheapestClosure}>
                        {gap.cheapestClosure}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paged>
        </Panel>
      )}
    </>
  ));
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
  return frame(resource, 'Hollow tests', 'Could not load hollow tests', (response) => (
    <>
      <PageHeader
        title="Hollow tests"
        subtitle="Green, and contributing nothing. A hollow test raises the pass rate and lowers no other number."
      />
      <Panel title="Register" className="flex-1">
        <Paged items={response.cells} reservedPx={DEEP_DIVE_RESERVED} label="hollow cell">
          {(page) => (
            <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <TableHeader>
                <TableRow>
                  <TableHead>Cell</TableHead>
                  <TableHead>Test fingerprints</TableHead>
                  <TableHead className="text-right">Signal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.map((cell) => (
                  <TableRow key={cell.cell}>
                    <TableCell className="font-mono">{cell.cell}</TableCell>
                    <TableCell
                      className="w-full max-w-0 truncate"
                      title={cell.hollowFingerprints.join(', ')}
                    >
                      {cell.hollowFingerprints.join(', ')}
                    </TableCell>
                    <TableCell numeric>{cell.signal.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paged>
      </Panel>
    </>
  ));
}

/** The flaky register, with the flake rate beside the fingerprints it describes. */
export function FlakyPage({ api, projectId }: ScreenProps): React.ReactElement {
  const resource = useResource<QaFlakyResponse>(() => api.getFlaky(projectId), [api, projectId]);
  return frame(resource, 'Flaky tests', 'Could not load flaky tests', (response) => (
    <>
      <PageHeader
        title="Flaky tests"
        subtitle="Same fingerprint, same commit, different outcome. Weak evidence never quarantines a test on its own."
      />
      <Panel title="Register" className="flex-1">
        <Paged items={response.cells} reservedPx={DEEP_DIVE_RESERVED} label="flaky cell">
          {(page) => (
            <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <TableHeader>
                <TableRow>
                  <TableHead>Cell</TableHead>
                  <TableHead>Fingerprints</TableHead>
                  <TableHead className="text-right">Flake rate</TableHead>
                  <TableHead className="text-right">Stability</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.map((cell) => (
                  <TableRow key={cell.cell}>
                    <TableCell className="font-mono">{cell.cell}</TableCell>
                    <TableCell
                      className="w-full max-w-0 truncate"
                      title={cell.flakyFingerprints.join(', ')}
                    >
                      {cell.flakyFingerprints.join(', ')}
                    </TableCell>
                    <TableCell numeric>{cell.flakeRate.toFixed(2)}</TableCell>
                    <TableCell numeric>{cell.stability.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paged>
      </Panel>
    </>
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
  return frame(
    resource,
    'Structural findings',
    'Could not load structural findings',
    (response) => (
      <>
        <PageHeader
          title="Structural findings"
          subtitle="Reported, never scored. Each names the cells it came from."
        />
        {response.findings.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title="No structural findings"
            description="No cell is present-but-empty, dominant, or single-layer."
          />
        ) : (
          <Panel title="Findings" className="flex-1">
            <Paged items={response.findings} reservedPx={DEEP_DIVE_RESERVED} label="finding">
              {(page) => (
                <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Finding</TableHead>
                      <TableHead>Statement</TableHead>
                      <TableHead className="text-right">Impact</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {page.map((finding) => (
                      <TableRow key={`${finding.kind}:${finding.cells.join(',')}`}>
                        <TableCell>{finding.kind}</TableCell>
                        <TableCell className="w-full max-w-0 truncate" title={finding.statement}>
                          {finding.statement}
                        </TableCell>
                        <TableCell numeric>{finding.impact.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Paged>
          </Panel>
        )}
      </>
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
