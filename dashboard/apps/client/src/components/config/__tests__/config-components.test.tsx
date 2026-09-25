import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen } from '../../../test/test-utils';
import { ProjectMatrix } from '../ProjectMatrix';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        return ({ initial: _initial, animate: _animate, exit: _exit, variants: _variants, whileHover: _whileHover, whileTap: _whileTap, transition: _transition, layout: _layout, layoutId: _layoutId, ...rest }: Record<string, unknown>) => {
          const tags = ['div', 'span', 'button', 'p', 'li', 'section', 'tr', 'td', 'form', 'ul', 'nav', 'header', 'footer', 'main', 'aside', 'article', 'label', 'input', 'a', 'h1', 'h2', 'h3', 'h4'];
          const Tag = typeof prop === 'string' && tags.includes(prop) ? prop : 'div';
          return React.createElement(Tag, rest);
        };
      },
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
  useMotionValue: (init: number) => ({ get: () => init, set: vi.fn(), on: vi.fn() }),
  useTransform: (_v: unknown, _input: unknown, output: number[]) => ({ get: () => output?.[0] ?? 0 }),
  useSpring: (v: unknown) => v,
}));

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange?: (value: string) => void }) =>
    React.createElement('textarea', {
      'data-testid': 'monaco-editor',
      value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value),
    }),
  Editor: ({ value, onChange }: { value: string; onChange?: (value: string) => void }) =>
    React.createElement('textarea', {
      'data-testid': 'monaco-editor',
      value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value),
    }),
}));

describe('config components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders project matrix global settings and project cards', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          path: '/repo/playwright.config.ts',
          workers: 4,
          retries: 1,
          globalTimeout: 120000,
          testDir: 'tests',
          outputDir: 'test-results',
          reporter: 'html',
          fullyParallel: true,
          forbidOnly: false,
          webServer: { command: 'pnpm dev', url: 'http://localhost:3000' },
          projects: [
            {
              name: 'chromium',
              testDir: 'tests/chromium',
              retries: 2,
              timeout: 60000,
              dependencies: ['setup'],
              grep: '@smoke',
              use: {
                browserName: 'chromium',
                baseURL: 'http://localhost:3000',
                viewport: { width: 1280, height: 720 },
                trace: 'retain-on-failure',
              },
            },
            {
              name: 'mobile safari',
              use: {
                browserName: 'webkit',
                viewport: { width: 390, height: 844 },
                headless: false,
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<ProjectMatrix />);

    expect(await screen.findByText('Global Settings')).toBeInTheDocument();
    expect(screen.getAllByText('chromium').length).toBeGreaterThan(0);
    expect(screen.getByText('mobile safari')).toBeInTheDocument();
    expect(screen.getByText('Depends on:')).toBeInTheDocument();
    expect(screen.getByText('setup')).toBeInTheDocument();
    expect(screen.getByText('grep: @smoke')).toBeInTheDocument();
    expect(screen.getByText('Web Server')).toBeInTheDocument();
  });

  it('renders parse error state when config request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'failed' }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<ProjectMatrix />);

    expect(await screen.findByText('Could not parse playwright config.')).toBeInTheDocument();
    expect(screen.getByText('Could not parse config')).toBeInTheDocument();
  });

  it('renders firefox and default browser icons', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          path: '/repo/playwright.config.ts',
          projects: [
            {
              name: 'firefox-project',
              use: { browserName: 'firefox' },
            },
            {
              name: 'unknown-browser',
              use: { browserName: 'unknown-custom-browser' },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<ProjectMatrix />);

    expect(await screen.findByText('firefox-project')).toBeInTheDocument();
    expect(screen.getByText('unknown-browser')).toBeInTheDocument();
  });

  it('renders mobile viewport icon for narrow viewports', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          path: '/repo/playwright.config.ts',
          projects: [
            {
              name: 'mobile-project',
              use: {
                browserName: 'webkit',
                viewport: { width: 390, height: 844 },
              },
            },
            {
              name: 'tablet-project',
              use: {
                browserName: 'chromium',
                viewport: { width: 768, height: 1024 },
              },
            },
            {
              name: 'no-viewport-project',
              use: { browserName: 'chromium' },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<ProjectMatrix />);

    expect(await screen.findByText('mobile-project')).toBeInTheDocument();
    // viewportIcon: mobile (≤430), tablet (≤820), no viewport (null → Monitor)
    expect(screen.getByText('390 × 844')).toBeInTheDocument();
    expect(screen.getByText('768 × 1024')).toBeInTheDocument();
    expect(screen.getByText('no-viewport-project')).toBeInTheDocument();
  });
});
