import { describe, expect, it } from 'vitest';
import { routeTree } from './router.js';
import {
  SECTIONS,
  isApplicationPath,
  repo360Path,
  routeManifest,
  runDetailPath,
  sectionOf,
  tabsOf,
  visibleRoutes,
} from './route-manifest.js';

/**
 * Every concrete path the router actually registers.
 *
 * Read from the route tree rather than from a second hand-written list, because a
 * second list is the same defect with a different file. TanStack's `routeTree`
 * exposes the leaves, and a route declared with a path is reachable; one declared
 * without a path is a layout, which is not a navigation target and is not in the
 * manifest either.
 */
function registeredPaths(): string[] {
  const paths: string[] = [];
  const walk = (node: {
    children?: Array<{ isLeaf?: boolean; path?: string; children?: unknown[] }>;
  }) => {
    for (const child of node.children ?? []) {
      if (typeof child.path === 'string') paths.push(child.path);
      walk(child as Parameters<typeof walk>[0]);
    }
  };
  walk(routeTree as unknown as { children?: Array<{ path?: string; children?: unknown[] }> });
  return paths;
}

describe('route manifest', () => {
  it('contains one canonical overview and run list', () => {
    expect(routeManifest.filter((route) => route.path === '/dashboard')).toHaveLength(1);
    expect(routeManifest.some((route) => route.path === '/dashboard/runs')).toBe(true);
  });

  it('has four sections, in the order the navigation draws them', () => {
    expect(SECTIONS.map((section) => section.label)).toEqual([
      'Overview',
      'Runs',
      'Insights',
      'Map',
    ]);
    for (const section of SECTIONS) {
      expect(isApplicationPath(section.path), `${section.label} opens nowhere`).toBe(true);
      expect(sectionOf(section.path)).toBe(section.id);
    }
  });

  it('exposes every old destination, now as a tab of a section', () => {
    expect(visibleRoutes.map((route) => route.path)).toEqual([
      '/dashboard/now',
      '/dashboard/portfolio',
      '/dashboard',
      '/dashboard/runs',
      '/dashboard/runner',
      '/dashboard/insights',
      '/dashboard/analytics',
      '/dashboard/quarantine',
      '/dashboard/delivery',
      '/dashboard/ai-code',
      '/dashboard/agents',
      '/dashboard/map',
      '/dashboard/health',
      '/dashboard/supply-chain',
      '/dashboard/toolbox',
      '/dashboard/access',
      '/dashboard/reports',
    ]);
    expect(visibleRoutes.every((route) => isApplicationPath(route.path))).toBe(true);
  });

  it('has no login route: the install is open (ADR-006)', () => {
    expect(routeManifest.map((route): string => route.path)).not.toContain('/login');
    expect(isApplicationPath('/login')).toBe(false);
  });

  it('puts every routed path in exactly one section', () => {
    for (const route of routeManifest) {
      const matches = SECTIONS.filter((section) => section.id === route.section);
      expect(matches, `${route.path} belongs to ${String(matches.length)} sections`).toHaveLength(
        1,
      );
    }
  });

  it.each([
    ['/dashboard', 'overview'],
    ['/dashboard/portfolio', 'overview'],
    ['/dashboard/repo/project-1', 'overview'],
    ['/dashboard/repo/project-1/overview', 'overview'],
    ['/dashboard/delivery', 'insights'],
    ['/dashboard/ai-code', 'insights'],
    ['/dashboard/agents', 'insights'],
    ['/dashboard/supply-chain', 'map'],
    ['/dashboard/runs', 'runs'],
    ['/dashboard/runs/run-1', 'runs'],
    ['/dashboard/runs/run-1/extra', 'runs'],
    ['/dashboard/runner', 'runs'],
    ['/dashboard/insights', 'insights'],
    ['/dashboard/analytics', 'insights'],
    ['/dashboard/quarantine', 'insights'],
    ['/dashboard/gaps/project-1', 'insights'],
    ['/dashboard/score/project-1', 'insights'],
    ['/dashboard/map', 'map'],
    ['/dashboard/health', 'map'],
    ['/dashboard/toolbox', 'map'],
  ] as const)('resolves %s to the %s section', (path, section) => {
    expect(sectionOf(path)).toBe(section);
  });

  it('resolves an unknown path to no section, so nothing is marked current by accident', () => {
    expect(sectionOf('/dashboard/unknown')).toBeNull();
    expect(sectionOf('/elsewhere')).toBeNull();
  });

  it('lists each section’s tabs, and the overview leads with Now', () => {
    expect(tabsOf('overview').map((tab) => tab.tab)).toEqual(['Now', 'Portfolio', 'Project']);
    expect(tabsOf('runs').map((tab) => tab.tab)).toEqual(['Runs', 'Launch']);
    expect(tabsOf('insights').map((tab) => tab.tab)).toEqual([
      'Tests',
      'Trends',
      'Quarantine',
      'Delivery',
      'AI code',
      'Agents',
    ]);
    expect(tabsOf('map').map((tab) => tab.tab)).toEqual([
      'Map',
      'Capabilities',
      'Supply chain',
      'Toolbox',
      'Access',
      'Reports',
    ]);
  });

  it('registers a path for every manifest entry, so nothing is unreachable', () => {
    // The failure this test used to be unable to catch. `isApplicationPath` is
    // *defined in the module under test*, so checking the manifest against it proves
    // the manifest agrees with itself, and `/dashboard/quarantine` sat in the router
    // while being absent from the manifest — reachable by URL, invisible to the
    // sidebar, and invisible to `isApplicationPath` as well. Nothing failed.
    const registered = new Set(registeredPaths());
    expect(registered.size, 'could not read any route path from the router').toBeGreaterThan(3);

    const applicationPaths = [...registered].filter(isApplicationPath);
    const declared = routeManifest.map((route) => route.path);
    for (const path of applicationPaths) {
      expect(declared, `route ${path} is registered but absent from the manifest`).toContain(path);
    }
    expect(
      [...registered].some((path) => path.replace(/\/$/u, '').endsWith('map')),
      'the map route is not registered',
    ).toBe(true);
  });

  it('registers the scorecard pages and the 360 in the router', () => {
    const registered = registeredPaths().map((path) => path.replace(/^\//u, ''));
    for (const path of [
      'supply-chain',
      'delivery',
      'ai-code',
      'agents',
      'repo/$projectId/overview',
    ]) {
      expect(registered, `${path} is in the manifest but not the router`).toContain(path);
    }
    expect(repo360Path('p 1')).toBe('/dashboard/repo/p%201/overview');
    expect(sectionOf(repo360Path('p 1'))).toBe('overview');
  });

  it('recognizes canonical run detail links without accepting arbitrary dashboard paths', () => {
    expect(isApplicationPath(runDetailPath('run 1'))).toBe(true);
    expect(isApplicationPath('/dashboard/runs/run%201?tab=events')).toBe(true);
    expect(isApplicationPath('/dashboard/runs/')).toBe(true);
    expect(isApplicationPath('/dashboard/unknown')).toBe(false);
    expect(isApplicationPath('/ai/agents')).toBe(false);
  });
});
