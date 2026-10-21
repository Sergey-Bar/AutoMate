/**
 * Every navigable page, and the section it belongs to.
 *
 * ## Four sections, and every old URL is still a page
 *
 * The product used to have eight top-level destinations. It has four now — Overview,
 * Runs, Insights, Map — and the eight became **tabs** of those sections rather than
 * being merged or redirected, so a bookmark to `/dashboard/analytics` opens the same
 * page it always did, now inside Insights. `section` is the one place that decision is
 * written; `NavBar`, `BottomTabBar`, `SectionTabs` and the command palette all read it.
 *
 * `label` is the page's own name (the palette says "Go to Trends"); `tab` is the short
 * label on its section's tab row. A page with no `tab` is a detail page — reachable from
 * a link, never from the tab row.
 */
export const SECTIONS = [
  { id: 'overview', label: 'Overview', path: '/dashboard' },
  { id: 'runs', label: 'Runs', path: '/dashboard/runs' },
  { id: 'insights', label: 'Insights', path: '/dashboard/insights' },
  { id: 'map', label: 'Map', path: '/dashboard/map' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

interface ManifestEntry {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly visible: boolean;
  /** `null` only for `login`, which is not routed (ADR-006) and is kept for the e2e sweep. */
  readonly section: SectionId | null;
  readonly tab?: string;
}

export const routeManifest = [
  { id: 'dashboard', path: '/dashboard', label: 'Overview', visible: true, section: 'overview' },
  {
    id: 'runs',
    path: '/dashboard/runs',
    label: 'Runs',
    visible: true,
    section: 'runs',
    tab: 'Runs',
  },
  {
    id: 'run-detail',
    path: '/dashboard/runs/:runId',
    label: 'Run Detail',
    visible: false,
    section: 'runs',
  },
  {
    id: 'runner',
    path: '/dashboard/runner',
    label: 'Launch',
    visible: true,
    section: 'runs',
    tab: 'Launch',
  },
  {
    id: 'insights',
    path: '/dashboard/insights',
    label: 'Insights',
    visible: true,
    section: 'insights',
    tab: 'Tests',
  },
  {
    id: 'analytics',
    path: '/dashboard/analytics',
    label: 'Trends',
    visible: true,
    section: 'insights',
    tab: 'Trends',
  },
  {
    id: 'quarantine',
    path: '/dashboard/quarantine',
    label: 'Quarantine',
    visible: true,
    section: 'insights',
    tab: 'Quarantine',
  },
  {
    id: 'score',
    path: '/dashboard/score/:projectId',
    label: 'Health Score',
    visible: false,
    section: 'insights',
  },
  {
    id: 'gaps',
    path: '/dashboard/gaps/:projectId',
    label: 'Automation Gaps',
    visible: false,
    section: 'insights',
  },
  {
    id: 'hollow',
    path: '/dashboard/hollow/:projectId',
    label: 'Hollow Tests',
    visible: false,
    section: 'insights',
  },
  {
    id: 'flaky',
    path: '/dashboard/flaky/:projectId',
    label: 'Flaky Tests',
    visible: false,
    section: 'insights',
  },
  {
    id: 'structure',
    path: '/dashboard/structure/:projectId',
    label: 'Structural Findings',
    visible: false,
    section: 'insights',
  },
  { id: 'map', path: '/dashboard/map', label: 'Map', visible: true, section: 'map', tab: 'Map' },
  {
    id: 'health',
    path: '/dashboard/health',
    label: 'Capabilities',
    visible: true,
    section: 'map',
    tab: 'Capabilities',
  },
  {
    id: 'toolbox',
    path: '/dashboard/toolbox',
    label: 'Toolbox',
    visible: true,
    section: 'map',
    tab: 'Toolbox',
  },
  { id: 'login', path: '/login', label: 'Login', visible: false, section: null },
] as const satisfies readonly ManifestEntry[];

export type ManifestRoute = (typeof routeManifest)[number];

export const visibleRoutes = routeManifest.filter((route) => route.visible);

function normalise(path: string): string {
  return path.split(/[?#]/u, 1)[0]?.replace(/\/$/u, '') || '/';
}

/** Whether `path` matches a manifest pattern, where a `:param` segment matches one segment. */
function matches(pattern: string, path: string): boolean {
  const want = pattern.split('/');
  const have = path.split('/');
  if (want.length !== have.length) return false;
  return want.every(
    (segment, index) =>
      segment === have[index] || (segment.startsWith(':') && (have[index] ?? '').length > 0),
  );
}

/** The manifest entry `path` opens, or `undefined`. */
export function routeFor(path: string): ManifestRoute | undefined {
  const normalized = normalise(path);
  return routeManifest.find((route) => matches(route.path, normalized));
}

export function isApplicationPath(path: string): boolean {
  const normalized = normalise(path);
  // `/dashboard/runs/` normalises to the list; anything under it is a run detail.
  return (
    routeFor(normalized) !== undefined ||
    (normalized.startsWith('/dashboard/runs/') && normalized.length > '/dashboard/runs/'.length)
  );
}

/** The section `path` sits in, or `null` for a path that is not a page. */
export function sectionOf(path: string): SectionId | null {
  return routeFor(path)?.section ?? null;
}

/** A page that has a place on its section's tab row. */
export type TabRoute = Extract<ManifestRoute, { tab: string }>;

/** A section's tab row, in manifest order. Empty for a one-page section. */
export function tabsOf(section: SectionId): TabRoute[] {
  const tabs = routeManifest.filter(
    (route): route is TabRoute => route.section === section && 'tab' in route,
  );
  return tabs.length > 1 ? tabs : [];
}

export function runDetailPath(runId: string): string {
  return `/dashboard/runs/${encodeURIComponent(runId)}`;
}
