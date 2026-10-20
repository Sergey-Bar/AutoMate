/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PRICING, ToolboxPage, sortToolbox } from './toolbox';
import { makeQa, makeScan } from '../../test-utils';
import type { ToolboxEntry } from '../../lib/qa';

describe('the toolbox', () => {
  it('opens on every tool, the recommended ones first and highest priority first', async () => {
    render(<ToolboxPage qa={makeQa()} />);
    await waitFor(() => expect(screen.getByTestId('toolbox-gitleaks')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Toolbox' })).toBeInTheDocument();
    expect(
      screen.getByText(
        '2 recommended for Automate · 1 already in use · 4 that fit its stack · 4 free',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    const cards = screen.getAllByRole('listitem').map((item) => item.dataset['testid']);
    expect(cards).toEqual([
      'toolbox-gitleaks',
      'toolbox-stryker',
      'toolbox-vitest',
      'toolbox-jest',
    ]);
    // A tile is the glyph, the name, and its status, and nothing else.
    expect(screen.getByTestId('toolbox-gitleaks')).toHaveTextContent('Gitleaks, recommended');
    expect(screen.getByTestId('toolbox-vitest')).toHaveTextContent('Vitest, in use');
    expect(screen.queryByText('gitleaks detect')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recommended' }));
    expect(screen.getAllByRole('listitem').map((item) => item.dataset['testid'])).toEqual([
      'toolbox-gitleaks',
      'toolbox-stryker',
    ]);
  });

  it('opens a tile into its detail: why, the setup line to copy, and the documentation', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ToolboxPage qa={makeQa()} />);
    await waitFor(() => expect(screen.getByTestId('toolbox-gitleaks')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Gitleaks/ }));
    const dialog = screen.getByTestId('toolbox-dialog');
    expect(dialog).toHaveTextContent('Secret scanning · high priority');
    expect(dialog).toHaveTextContent('gitleaks detect');
    const docs = screen.getByRole('link', { name: 'Gitleaks documentation (opens in a new tab)' });
    expect(docs).toHaveAttribute('href', 'https://github.com/gitleaks/gitleaks');
    expect(docs).toHaveAttribute('rel', 'noreferrer noopener');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Gitleaks setup' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copied Gitleaks setup' })).toBeInTheDocument(),
    );
    expect(writeText).toHaveBeenCalledWith('gitleaks detect');
  });

  it('closes the detail, and the next tile opens its own', async () => {
    render(<ToolboxPage qa={makeQa()} />);
    await waitFor(() => expect(screen.getByTestId('toolbox-stryker')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Stryker/ }));
    expect(screen.getByTestId('toolbox-dialog')).toHaveTextContent('npm init stryker@latest');
    fireEvent(screen.getByTestId('toolbox-dialog'), new Event('close'));
    await waitFor(() => expect(screen.queryByText('npm init stryker@latest')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Gitleaks/ }));
    expect(screen.getByTestId('toolbox-dialog')).toHaveTextContent('gitleaks detect');
  });

  it('filters by status, by capability and by text', async () => {
    render(<ToolboxPage qa={makeQa()} />);
    await waitFor(() => expect(screen.getByTestId('toolbox-gitleaks')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'In use' }));
    expect(screen.getAllByRole('listitem').map((item) => item.dataset['testid'])).toEqual([
      'toolbox-vitest',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByTestId('toolbox-capability'), { target: { value: 'unit' } });
    expect(screen.getAllByRole('listitem').map((item) => item.dataset['testid'])).toEqual([
      'toolbox-vitest',
      'toolbox-jest',
    ]);
    fireEvent.change(screen.getByTestId('toolbox-search'), { target: { value: 'another' } });
    expect(screen.getAllByRole('listitem').map((item) => item.dataset['testid'])).toEqual([
      'toolbox-jest',
    ]);
    fireEvent.change(screen.getByTestId('toolbox-search'), { target: { value: 'zzz' } });
    expect(screen.getByTestId('toolbox-empty')).toHaveTextContent('No tool matches.');
  });

  it('says so when there is nothing to recommend', async () => {
    const toolbox = makeScan().toolbox.filter((entry) => entry.status !== 'recommended');
    render(<ToolboxPage qa={makeQa({ getScan: vi.fn(async () => makeScan({ toolbox })) })} />);
    await waitFor(() => expect(screen.getByTestId('toolbox-vitest')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Recommended' }));
    expect(screen.getByTestId('toolbox-empty')).toHaveTextContent('Nothing to recommend');
  });

  it('reports a scan failure, and a scan in flight', async () => {
    render(
      <ToolboxPage
        qa={makeQa({
          getScan: vi.fn(async () => {
            throw new Error('scan refused');
          }),
        })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('toolbox-error')).toHaveTextContent('scan refused'),
    );
    render(
      <ToolboxPage qa={makeQa({ getScan: vi.fn(() => new Promise<never>(() => undefined)) })} />,
    );
    await waitFor(() => expect(screen.getByTestId('toolbox-loading')).toBeInTheDocument());
  });

  it('sorts recommended before in use before available, then by priority and name', () => {
    const sorted = sortToolbox(makeScan().toolbox).map((entry) => entry.id);
    expect(sorted).toEqual(['gitleaks', 'stryker', 'vitest', 'jest']);
  });
});

describe('the toolbox by price', () => {
  const PAID: ToolboxEntry = {
    id: 'browserstack',
    name: 'BrowserStack',
    capability: 'e2e',
    description: 'Real browsers in the cloud.',
    ecosystems: ['any'],
    status: 'available',
    priority: 'high',
    reason: 'An alternative for e2e.',
    setup: 'npx browserstack-node-sdk playwright test',
    docsUrl: 'https://www.browserstack.com/docs',
    pricing: 'paid',
    vendorUrl: 'https://www.browserstack.com/pricing',
  };
  const FREEMIUM: ToolboxEntry = {
    ...PAID,
    id: 'percy',
    name: 'Percy',
    capability: 'visual',
    pricing: 'freemium',
    vendorUrl: 'https://www.browserstack.com/pricing?product=percy',
  };
  const qa = () =>
    makeQa({
      getScan: vi.fn(async () => makeScan({ toolbox: [...makeScan().toolbox, PAID, FREEMIUM] })),
    });

  it('badges every tile with its tier, and filters by it', async () => {
    render(<ToolboxPage qa={qa()} />);
    await waitFor(() => expect(screen.getByTestId('toolbox-browserstack')).toBeInTheDocument());
    expect(screen.getByTestId('toolbox-browserstack')).toHaveTextContent('Paid');
    expect(screen.getByTestId('toolbox-percy')).toHaveTextContent('Freemium');
    expect(screen.getByTestId('toolbox-vitest')).toHaveTextContent('Free');
    const ids = () => screen.getAllByRole('listitem').map((item) => item.dataset['testid']);

    fireEvent.click(screen.getByRole('button', { name: 'Paid' }));
    expect(ids()).toEqual(['toolbox-browserstack']);
    fireEvent.click(screen.getByRole('button', { name: 'Freemium' }));
    expect(ids()).toEqual(['toolbox-percy']);
    // The phone control is the same filter, not a second one.
    fireEvent.change(screen.getByTestId('toolbox-pricing'), { target: { value: 'free' } });
    expect(ids()).toEqual([
      'toolbox-gitleaks',
      'toolbox-stryker',
      'toolbox-vitest',
      'toolbox-jest',
    ]);
    expect(screen.getByRole('button', { name: 'Free' })).toHaveAttribute('aria-pressed', 'true');
    // Combined with capability: nothing that is free and e2e in this fixture.
    fireEvent.change(screen.getByTestId('toolbox-capability'), { target: { value: 'e2e' } });
    expect(screen.getByTestId('toolbox-empty')).toHaveTextContent('No tool matches.');
    fireEvent.click(screen.getByRole('button', { name: 'Any price' }));
    expect(ids()).toEqual(['toolbox-browserstack']);
  });

  it('links a paid tool to its vendor, and says when a tool needs no plan', async () => {
    render(<ToolboxPage qa={qa()} />);
    await waitFor(() => expect(screen.getByTestId('toolbox-browserstack')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /BrowserStack/ }));
    const pricing = screen.getByRole('link', { name: 'BrowserStack pricing (opens in a new tab)' });
    expect(pricing).toHaveAttribute('href', 'https://www.browserstack.com/pricing');
    expect(pricing).toHaveAttribute('rel', 'noreferrer noopener');
    fireEvent(screen.getByTestId('toolbox-dialog'), new Event('close'));
    fireEvent.click(screen.getByRole('button', { name: /Vitest/ }));
    expect(screen.getByTestId('toolbox-dialog')).toHaveTextContent('No paid plan needed');
    expect(screen.queryByRole('link', { name: /pricing/u })).not.toBeInTheDocument();
  });

  it('names every tier the badge can draw', () => {
    expect(Object.keys(PRICING)).toEqual(['free', 'freemium', 'paid']);
  });
});
