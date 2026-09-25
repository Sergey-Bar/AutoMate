import { describe, it, expect, vi } from 'vitest';

vi.mock('../components/layout/AppLayout.js', () => ({
  AppLayout: () => null,
}));

import { router } from '../router.js';

describe('router — bootstrap smoke tests', () => {
  it('router instance is defined', () => {
    expect(router).toBeDefined();
  });

  it('router has a routeTree', () => {
    expect(router.routeTree).toBeDefined();
  });

  it('root route id is __root__', () => {
    expect(router.routeTree.id).toBe('__root__');
  });

  it('route tree has exactly 6 child routes', () => {
    const children = router.routeTree.children;
    expect(children).toBeDefined();
    expect(Object.values(children!)).toHaveLength(6);
  });

  it('route tree contains all expected paths', () => {
    const children = router.routeTree.children;
    const paths = Object.values(children!).map((r: { path: string }) => r.path);

    expect(paths).toContain('/');
    expect(paths).toContain('chat/$conversationId');
    expect(paths).toContain('settings/connectors');
    expect(paths).toContain('settings/model');
    expect(paths).toContain('settings/vault');
    expect(paths).toContain('sql');
  });

  it('all child routes are configured with a lazy-loadable component', () => {
    const children = router.routeTree.children;
    expect(children).toBeDefined();
    const routes = Object.values(children!) as Array<{
      options?: { component?: { preload?: unknown } };
    }>;
    for (const r of routes) {
      expect(r.options?.component).toBeDefined();
      expect(typeof r.options?.component?.preload).toBe('function');
    }
  });
});
