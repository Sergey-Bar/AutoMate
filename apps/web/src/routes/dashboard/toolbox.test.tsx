/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToolboxPage, sortToolbox } from './toolbox';
import { makeQa, makeScan } from '../../test-utils';

describe('the toolbox', () => {
  it('opens on every tool, the recommended ones first and highest priority first', async () => {
    render(<ToolboxPage qa={makeQa()} />);
    await waitFor(() => expect(screen.getByTestId('toolbox-gitleaks')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Toolbox' })).toBeInTheDocument();
    expect(
      screen.getByText('2 recommended for Automate · 1 already in use · 4 that fit its stack'),
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
