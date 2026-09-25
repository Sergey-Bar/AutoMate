export const routeManifest = [
  { id: 'command-center', path: '/dashboard', label: 'Command Center', visible: true },
  { id: 'runs', path: '/dashboard/runs', label: 'Runs', visible: true },
  { id: 'run-detail', path: '/dashboard/runs/:runId', label: 'Run Detail', visible: false },
  { id: 'analytics', path: '/dashboard/analytics', label: 'Analytics', visible: true },
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
