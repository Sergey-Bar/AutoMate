/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HealthPage } from './health';
import { makeQa, makeScan } from '../../test-utils';

describe('the health page', () => {
  it('shows every capability as covered or missing, in words as well as an icon', async () => {
    render(<HealthPage qa={makeQa()} />);
    await waitFor(() => expect(screen.getByTestId('capability-unit')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Capabilities' })).toBeInTheDocument();
    expect(screen.getByTestId('capability-unit')).toHaveAttribute('data-covered', 'true');
    expect(screen.getByTestId('capability-unit')).toHaveTextContent(
      'Unit tests, coveredVitest, pnpm run test',
    );
    expect(screen.getByTestId('capability-mutation')).toHaveTextContent(
      'Mutation, missingNothing covers this yet',
    );
    expect(screen.getByTestId('health-maturity')).toHaveTextContent('50%');
    expect(screen.getByText('0.40')).toBeInTheDocument();
  });

  it('lists the reports on disk, paged', async () => {
    const reports = Array.from({ length: 8 }, (_, index) => ({
      path: `r${String(index)}.xml`,
      kind: 'tests' as const,
      format: 'junit-xml',
      headline: `report ${String(index)}`,
      metrics: {},
      status: 'good' as const,
    }));
    render(<HealthPage qa={makeQa({ getScan: vi.fn(async () => makeScan({ reports })) })} />);
    const panel = await screen.findByTestId('health-reports');
    await waitFor(() => expect(within(panel).getByText('1–6 of 8')).toBeInTheDocument());
    expect(within(panel).getByTestId('report-r0.xml')).toHaveTextContent('report 0');
    fireEvent.click(within(panel).getByRole('button', { name: 'Next report page' }));
    expect(within(panel).getByTestId('report-r7.xml')).toBeInTheDocument();
  });

  it('says when there are no reports, and no ratio without source files', async () => {
    render(
      <HealthPage
        qa={makeQa({
          getScan: vi.fn(async () => makeScan({ reports: [], sourceFiles: 0, ecosystems: [] })),
        })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('health-reports')).toHaveTextContent('No coverage, JUnit'),
    );
    expect(screen.getByText('no ecosystem')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('rescans without the cache, and reports a scan failure', async () => {
    const qa = makeQa();
    render(<HealthPage qa={qa} />);
    await waitFor(() => expect(qa.getScan).toHaveBeenCalledWith('project-1', false));
    fireEvent.click(screen.getByTestId('health-rescan'));
    await waitFor(() => expect(qa.getScan).toHaveBeenLastCalledWith('project-1', true));

    render(
      <HealthPage
        qa={makeQa({
          getScan: vi.fn(async () => {
            throw new Error('unreadable');
          }),
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('health-error')).toHaveTextContent('unreadable'));
  });

  it('shows the loading state while the scan is in flight', async () => {
    render(
      <HealthPage qa={makeQa({ getScan: vi.fn(() => new Promise<never>(() => undefined)) })} />,
    );
    await waitFor(() => expect(screen.getByTestId('health-loading')).toBeInTheDocument());
  });
});
