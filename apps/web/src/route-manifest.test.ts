import { describe, expect, it } from 'vitest';
import { routeTree } from './router.js';
import {
  isApplicationPath,
  routeManifest,
  runDetailPath,
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
  it('contains one canonical command center and run list', () => {
    expect(routeManifest.filter((route) => route.path === '/dashboard')).toHaveLength(1);
    expect(routeManifest.some((route) => route.path === '/dashboard/runs')).toBe(true);
  });

  it('exposes only registered navigation targets', () => {
    expect(visibleRoutes.map((route) => route.path)).toEqual([
      '/dashboard',
      '/dashboard/runs',
      '/dashboard/analytics',
      '/dashboard/quarantine',
    ]);
    expect(visibleRoutes.every((route) => isApplicationPath(route.path))).toBe(true);
  });

  it('registers a path for every manifest entry, so nothing is unreachable', () => {
    // The failure this test used to be unable to catch. `isApplicationPath` is
    // *defined in the module under test*, so checking the manifest against it proves
    // the manifest agrees with itself, and `/dashboard/quarantine` sat in the router
    // while being absent from the manifest — reachable by URL, invisible to the
    // sidebar, and invisible to `isApplicationPath` as well. Nothing failed.
    //
    // The manifest is the only navigation source, so a registered route missing from
    // it is a page no one can reach by clicking.
    const registered = new Set(registeredPaths());
    expect(registered.size, 'could not read any route path from the router').toBeGreaterThan(3);

    const applicationPaths = [...registered].filter(isApplicationPath);
    const declared = routeManifest.map((route) => route.path);
    for (const path of applicationPaths) {
      // `run-detail` is a parameterised path, and the manifest spells it `:runId` too,
      // so the two are directly comparable; anything else must match exactly.
      expect(declared, `route ${path} is registered but absent from the manifest`).toContain(path);
    }
  });

  it('recognizes canonical run detail links without accepting arbitrary dashboard paths', () => {
    expect(isApplicationPath(runDetailPath('run 1'))).toBe(true);
    expect(isApplicationPath('/dashboard/runs/run%201?tab=events')).toBe(true);
    expect(isApplicationPath('/dashboard/runs/')).toBe(true);
    expect(isApplicationPath('/dashboard/unknown')).toBe(false);
    expect(isApplicationPath('/ai/agents')).toBe(false);
  });
});
