export const routeManifest = [
  { id: 'command-center', path: '/dashboard', label: 'Command Center', visible: true },
  { id: 'runs', path: '/dashboard/runs', label: 'Runs', visible: true },
  { id: 'run-detail', path: '/dashboard/runs/:runId', label: 'Run Detail', visible: false },
  { id: 'analytics', path: '/dashboard/analytics', label: 'Analytics', visible: true },
  { id: 'quarantine', path: '/dashboard/quarantine', label: 'Quarantine', visible: true },
  { id: 'score', path: '/dashboard/score/:projectId', label: 'Health Score', visible: false },
  { id: 'gaps', path: '/dashboard/gaps/:projectId', label: 'Automation Gaps', visible: false },
  { id: 'hollow', path: '/dashboard/hollow/:projectId', label: 'Hollow Tests', visible: false },
  { id: 'flaky', path: '/dashboard/flaky/:projectId', label: 'Flaky Tests', visible: false },
  {
    id: 'structure',
    path: '/dashboard/structure/:projectId',
    label: 'Structural Findings',
    visible: false,
  },
  { id: 'login', path: '/login', label: 'Login', visible: false },
] as const;

export type ManifestRoute = (typeof routeManifest)[number];

export const visibleRoutes = routeManifest.filter((route) => route.visible);

export function isApplicationPath(path: string): boolean {
  const normalized = path.split(/[?#]/u, 1)[0]?.replace(/\/$/u, '') || '/';
  return routeManifest.some((route) => {
    if (route.path === normalized) return true;
    if (!route.path.includes('/:runId')) return false;
    const prefix = route.path.slice(0, -':runId'.length);
    return normalized.startsWith(prefix) && normalized.length > prefix.length;
  });
}

export function runDetailPath(runId: string): string {
  return `/dashboard/runs/${encodeURIComponent(runId)}`;
}
