import { describe, expect, it } from 'vitest';
import {
  isApplicationPath,
  routeManifest,
  runDetailPath,
  visibleRoutes,
} from './route-manifest.js';

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
    ]);
    expect(visibleRoutes.every((route) => isApplicationPath(route.path))).toBe(true);
  });

  it('recognizes canonical run detail links without accepting arbitrary dashboard paths', () => {
    expect(isApplicationPath(runDetailPath('run 1'))).toBe(true);
    expect(isApplicationPath('/dashboard/runs/run%201?tab=events')).toBe(true);
    expect(isApplicationPath('/dashboard/runs/')).toBe(true);
    expect(isApplicationPath('/dashboard/unknown')).toBe(false);
    expect(isApplicationPath('/ai/agents')).toBe(false);
  });
});
