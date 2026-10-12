import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QaToolsPage, Route } from './tools.js';
import type { ApiClient } from '../../lib/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The tools screen, against the shape the probe route answers.
 *
 * ## Why the fetch is stubbed and the client is not injected
 *
 * `QaToolsPage` reads `/toolchain` through the app's own fetch wrapper, and the
 * window it calls is a plain fetch. A stub of `fetch` is the honest controller: the
 * API method it needs does not exist on `ApiClient` (by design — the toolchain is a
 * *project* read, not a dashboard one), so a fake client would be a fake.
 *
 * What is asserted is the evidence property: a detected tool names its file, an
 * undetected one names nothing, and the coverage figure is a join over both.
 */

const NODE_REPO = [
  { toolId: 'vitest', detected: true, evidence: 'vitest.config.ts', version: '^2.1.8' },
  { toolId: 'playwright', detected: true, evidence: 'playwright.config.ts', version: '^1.47.0' },
  { toolId: 'k6', detected: false, evidence: null, version: null },
];

function stubToolchain(detections: unknown[], ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      json: vi.fn().mockResolvedValue({ projectId: 'p1', detections }),
    }),
  );
}

const api = {} as ApiClient;

/**
 * A StatCard's own figure, without the sentence beside it.
 *
 * The card renders the title, the value and the description in one subtree, so
 * `textContent` over the card yields `24` for a detected count of two with a
 * coverage of 4 percent — a digit run across two different facts. The figure is
 * read from the element the primitive puts it in, which is the only place the
 * number itself lives.
 */
function figureOf(card: HTMLElement): string {
  const figure = card.querySelector('.tabular-nums');
  return figure?.textContent ?? '';
}

describe('QaToolsPage', () => {
  it('renders the three registry figures from the probe', async () => {
    stubToolchain(NODE_REPO);
    render(<QaToolsPage api={api} projectId="p1" />);
    await screen.findByTestId('tools-detected-list');
    // The registry count comes from the package, not from the fixture — fifty
    // tools is a fact about the catalogue, and a fixture that named a number
    // would be testing the fixture.
    expect(figureOf(screen.getByTestId('tools-total'))).toBe('50');
    expect(figureOf(screen.getByTestId('tools-detected'))).toBe('2');
  });

  it('shows the evidence for a detected tool and nothing for an undetected one', async () => {
    stubToolchain(NODE_REPO);
    render(<QaToolsPage api={api} projectId="p1" />);
    await screen.findByTestId('tools-detected-list');
    // **The evidence is the path.** A row without it would be a claim the reader
    // cannot check, which is the whole reason the probe exists.
    expect(screen.getByTestId('evidence-vitest')).toHaveTextContent('vitest.config.ts');
    const k6 = screen.getByTestId('tool-k6');
    expect(k6).toBeInTheDocument();
    expect(screen.queryByTestId('evidence-k6')).not.toBeInTheDocument();
  });

  it('names the missing essentials rather than only counting them', async () => {
    stubToolchain([
      { toolId: 'vitest', detected: true, evidence: 'vitest.config.ts', version: '^2' },
    ]);
    render(<QaToolsPage api={api} projectId="p1" />);
    await screen.findByTestId('tools-detected-list');
    // A count with no names is a number nobody can act on: the operator needs to
    // know *which* tools to install, and the card says so.
    expect(screen.getByTestId('tools-missing').textContent).toMatch(/Playwright|axe|semgrep|c8/u);
  });

  it('says plainly that no project was chosen, without rendering an empty stack', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<QaToolsPage api={api} />);
    expect(screen.getByTestId('tools-no-project')).toBeInTheDocument();
    // **No probe call.** A screen that fetched without a project would read
    // `/api/v1/projects/undefined/toolchain` and report the 404 as a failure.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tools-detected-list')).not.toBeInTheDocument();
  });

  it('reports a failed probe as the failure it is, not as an empty stack', async () => {
    stubToolchain([], false);
    render(<QaToolsPage api={api} projectId="p1" />);
    const error = await screen.findByTestId('tools-error');
    expect(error).toHaveTextContent('The probe did not answer');
    // An empty-detected list would be a report about the repository; this is a
    // report about the read, and the two must not look the same.
    expect(screen.queryByTestId('tools-detected-list')).not.toBeInTheDocument();
  });

  it('keeps one h1, because both states render inside one shell', () => {
    stubToolchain(NODE_REPO);
    render(<QaToolsPage api={api} projectId="p1" />);
    // The composition rule the sweep enforces: a heading list with no name for the
    // screen has no name for the screen. Two states, one title.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('renders through its own route component, which is how the router mounts it', () => {
    // The route's `component` factory is what the router calls, and a factory
    // nothing invokes is a screen the router cannot reach. This is the seam
    // `Composition.test.tsx` and the router itself both read.
    const options = Route.options as unknown as { component: () => React.ReactNode };
    const element = options.component();
    expect(React.isValidElement(element)).toBe(true);
    expect((element as React.ReactElement).type).toBe(QaToolsPage);
  });
});
