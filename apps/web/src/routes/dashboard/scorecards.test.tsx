import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from '../../router.js';
import { TEST_PROJECT } from '../../test-utils.js';

/**
 * The scorecard routes, mounted by the real router with their own clients.
 *
 * The pages have their own suites; this one proves each route is registered, honours the
 * `?project=` a link carries, and reaches its page past both gates. Every read other than the
 * registry and `whoami` is refused, so each page is seen showing the server's sentence.
 */
function stubApi(seen: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.endsWith('/api/v1/auth/whoami'))
        return reply({ actor: 'someone', role: 'viewer', mode: 'enforced' });
      if (url.endsWith('/api/v1/projects'))
        return reply({
          projects: [TEST_PROJECT, { ...TEST_PROJECT, id: 'project-2', name: 'Other' }],
        });
      return reply({ error: { message: 'Not reported here' } }, 503);
    }),
  );
}

beforeAll(() => {
  Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the scorecard routes', () => {
  it.each([
    ['/dashboard/supply-chain', 'supply-chain-page', '/health/findings'],
    ['/dashboard/delivery', 'delivery-page', '/delivery?days=30'],
    ['/dashboard/ai-code', 'ai-code-page', '/ai-code?days=90'],
    ['/dashboard/agents', 'agents-page', '/evals'],
  ])('opens %s for the project its link names', async (path, testId, read) => {
    const seen: string[] = [];
    stubApi(seen);
    render(<MemoryRouter initialEntries={[`${path}?project=project-2`]} />);
    expect(await screen.findByTestId(testId, {}, { timeout: 10_000 })).toBeInTheDocument();
    // The page can render before its first read is sent: wait for the read, under load too.
    await waitFor(
      () => expect(seen.some((url) => url.includes(`/projects/project-2${read}`))).toBe(true),
      { timeout: 10_000 },
    );
  });

  it('opens a page on the first project when no link names one', async () => {
    const seen: string[] = [];
    stubApi(seen);
    render(<MemoryRouter initialEntries={['/dashboard/delivery']} />);
    expect(await screen.findByTestId('delivery-page', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(
      (await screen.findAllByText(/Not reported here/u, {}, { timeout: 10_000 })).length,
    ).toBeGreaterThan(0);
    expect(seen.some((url) => url.includes('/projects/project-1/delivery?days=30'))).toBe(true);
  });

  it('opens the 360 by the id in its path', async () => {
    const seen: string[] = [];
    stubApi(seen);
    render(<MemoryRouter initialEntries={['/dashboard/repo/project-2/overview']} />);
    expect(await screen.findByTestId('repo-360', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(seen.some((url) => url.endsWith('/projects/project-2/health'))).toBe(true);
  });
});
