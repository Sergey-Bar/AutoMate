import { createRoute, useParams } from '@tanstack/react-router';
import { Route as rootRoute } from './__root.js';
import { RunExplorer } from '../components/dashboard/RunExplorer.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reporting/$runId',
  component: ReportingRunRoute,
});

function ReportingRunRoute() {
  const { runId } = useParams({ from: '/reporting/$runId' });
  return <RunExplorer runId={runId} />;
}
