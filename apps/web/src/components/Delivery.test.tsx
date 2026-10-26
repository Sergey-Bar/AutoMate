import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DeliveryReport } from '@automate/shared-contracts';
import type { DeliveryClient } from '../lib/delivery-client.js';
import {
  makeDeliveryReport,
  makeDeliverySource,
  makeHealthDouble,
  makePortfolioDelivery,
  makeQa,
  pending,
  serverRefusal,
  TEST_PROJECT,
} from '../test-utils.js';
import { DeliveryPage, listField } from './Delivery.js';
import { ToastProvider } from './Toasts.js';

function deliveryDouble(overrides: Partial<DeliveryClient> = {}): DeliveryClient {
  return {
    getReport: vi.fn(async () => makeDeliveryReport()),
    getSource: vi.fn(async () => makeDeliverySource()),
    setSource: vi.fn(async () => makeDeliverySource()),
    sync: vi.fn(async () => ({
      syncId: '33333333-3333-4333-8333-333333333333',
      duplicate: false,
      requestedBy: 'operator' as const,
    })),
    getPortfolio: vi.fn(async () => makePortfolioDelivery()),
    ...overrides,
  };
}

function renderDelivery(
  delivery: DeliveryClient = deliveryDouble(),
  role: 'viewer' | 'operator' | 'admin' = 'operator',
) {
  return render(
    <ToastProvider>
      <DeliveryPage qa={makeQa()} health={makeHealthDouble(role)} delivery={delivery} />
    </ToastProvider>,
  );
}

describe('the delivery page', () => {
  it('leads with how many scorecards fail, then DORA and flow', async () => {
    const delivery = deliveryDouble();
    renderDelivery(delivery);
    expect(await screen.findByTestId('delivery-status')).toHaveTextContent(
      '1of the two delivery scorecards fails',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Delivery' })).toBeInTheDocument();
    expect(screen.getByTestId('scorecard-delivery')).toHaveTextContent('DORA');
    expect(screen.getByTestId('scorecard-flow')).toHaveTextContent(
      'Review latency 30 h is over the 24 h limit',
    );
    expect(delivery.getReport).toHaveBeenCalledWith(TEST_PROJECT.id, 30);
  });

  it('reads another window when one is chosen', async () => {
    const delivery = deliveryDouble();
    renderDelivery(delivery);
    fireEvent.click(await screen.findByRole('button', { name: '90 days' }));
    await waitFor(() => expect(delivery.getReport).toHaveBeenCalledWith(TEST_PROJECT.id, 90));
  });

  it('gives every DORA metric its tier, says when there is too little data, and cites the bands', async () => {
    renderDelivery();
    const deploys = await screen.findByTestId('dora-deploymentFrequency');
    expect(deploys).toHaveTextContent('3.5/week');
    expect(deploys).toHaveTextContent('elite');
    expect(screen.getByTestId('dora-changeFailureRate')).toHaveTextContent('10.0%');
    expect(screen.getByTestId('dora-recoveryTime')).toHaveTextContent('too little data (needs 5)');
    expect(screen.getByTestId('dora-recoveryTime')).toHaveTextContent('no tier');
    expect(screen.getByTestId('dora-source')).toHaveTextContent('DORA 2024 bands');
    expect(
      within(screen.getByTestId('dora-source')).getByRole('link', {
        name: 'Accelerate State of DevOps Report 2024',
      }),
    ).toHaveAttribute('href', 'https://dora.dev/research/2024/dora-report/');
  });

  it('breaks cycle time into stages, sizes and stale pull requests', async () => {
    renderDelivery();
    expect(await screen.findByTestId('stage-pickup')).toHaveTextContent('Pickup6.0 h12.0 h9');
    expect(screen.getByTestId('stage-review')).toHaveTextContent('Review——0');
    expect(screen.getByTestId('size-XL')).toHaveTextContent('XL1');
    expect(screen.getByTestId('stale-prs')).toHaveTextContent('#41 Refactor the importer');
    expect(screen.getByTestId('stale-prs')).toHaveTextContent('12 days idle');
    expect(screen.getByTestId('sync-status')).toHaveTextContent(
      'Computed over 18 deployments, 14 pull requests and 1 incidents, in production.',
    );
    expect(screen.getByTestId('sync-status')).toHaveTextContent('Latest sync: done');
  });

  it('says what each empty panel is waiting for', async () => {
    const empty = makeDeliveryReport();
    renderDelivery(
      deliveryDouble({
        getReport: vi.fn(async () => ({
          ...empty,
          dora: { ...empty.dora, status: 'insufficient' as const, score: null, cappedBy: null },
          flow: { ...empty.flow, status: 'pass' as const, reasons: [] },
          stalePullRequests: [],
          flowResult: { ...empty.flowResult, sizes: { XS: 0, S: 0, M: 0, L: 0, XL: 0 } },
          sync: {
            ...empty.sync,
            configured: false,
            lastStatus: null,
            lastError: null,
            latest: null,
          },
        })),
      }),
    );
    expect(await screen.findByTestId('delivery-status')).toHaveTextContent('0');
    expect(screen.getByTestId('scorecard-delivery')).toHaveTextContent('Too little data');
    expect(screen.getByTestId('size-mix')).toHaveTextContent('No pull request merged');
    expect(screen.getByTestId('stale-prs')).toHaveTextContent('idle more than 7 days');
    expect(screen.getByTestId('sync-status')).toHaveTextContent('No delivery source is configured');
  });

  it.each([
    [{ enabled: false }, 'saved but turned off'],
    [{ rateLimitedUntil: '2026-10-23T13:00:00.000Z' }, 'rate limiting the sync until'],
    [{ lastStatus: 'failed' as const, lastError: 'Bad credentials' }, 'Bad credentials'],
  ])('describes a sync in state %o', async (sync, text) => {
    const report = makeDeliveryReport();
    renderDelivery(
      deliveryDouble({
        getReport: vi.fn(async () => ({ ...report, sync: { ...report.sync, ...sync } })),
      }),
    );
    expect(await screen.findByTestId('sync-status')).toHaveTextContent(text);
  });

  it('shows the server’s message when the report fails, and a read in flight', async () => {
    const { unmount } = renderDelivery(
      deliveryDouble({
        getReport: vi.fn(async () => {
          throw serverRefusal('No project p-1', 404);
        }),
      }),
    );
    expect(await screen.findByTestId('delivery-error')).toHaveTextContent('No project p-1');
    unmount();
    renderDelivery(deliveryDouble({ getReport: vi.fn(() => pending<DeliveryReport>()) }));
    expect(await screen.findByTestId('delivery-loading')).toBeInTheDocument();
  });

  it('queues a sync for an operator and confirms it', async () => {
    const delivery = deliveryDouble();
    renderDelivery(delivery);
    fireEvent.click(await screen.findByTestId('delivery-sync'));
    await waitFor(() => expect(delivery.sync).toHaveBeenCalledWith(TEST_PROJECT.id));
    expect(await screen.findByText('Sync queued')).toBeInTheDocument();
    await waitFor(() => expect(delivery.getReport).toHaveBeenCalledTimes(2));
  });

  it('says a sync was already waiting, and says why one failed', async () => {
    const delivery = deliveryDouble({
      sync: vi
        .fn()
        .mockResolvedValueOnce({
          syncId: '33333333-3333-4333-8333-333333333333',
          duplicate: true,
          requestedBy: 'operator',
        })
        .mockRejectedValueOnce(serverRefusal('Not a GitHub repository', 409)),
    });
    renderDelivery(delivery);
    fireEvent.click(await screen.findByTestId('delivery-sync'));
    expect(await screen.findByText('A sync was already queued')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('delivery-sync')).toBeEnabled());
    fireEvent.click(screen.getByTestId('delivery-sync'));
    expect(await screen.findByText('Not a GitHub repository')).toBeInTheDocument();
  });

  it('hides the operator’s actions from a viewer and shows the source read-only', async () => {
    renderDelivery(deliveryDouble(), 'viewer');
    expect(await screen.findByTestId('delivery-status')).toBeInTheDocument();
    expect(screen.queryByTestId('delivery-sync')).not.toBeInTheDocument();
    const source = await screen.findByTestId('delivery-source');
    await waitFor(() => expect(source).toHaveTextContent('acme/service'));
    expect(within(source).queryByRole('button', { name: 'Save source' })).not.toBeInTheDocument();
    expect(source).toHaveTextContent('On, daily');
    expect(source).toHaveTextContent('Deploy');
  });

  it.each([
    [{ configured: false }, 'Not configured'],
    [{ enabled: false }, 'Off'],
    [{ repository: null, deployWorkflows: [], nextSyncAt: null }, 'Not a GitHub repository'],
  ])('summarises a source in state %o', async (source, text) => {
    renderDelivery(
      deliveryDouble({ getSource: vi.fn(async () => makeDeliverySource(source)) }),
      'viewer',
    );
    const panel = await screen.findByTestId('delivery-source');
    await waitFor(() => expect(panel).toHaveTextContent(text));
  });

  it('saves the source for an operator, and refuses an empty production list', async () => {
    const delivery = deliveryDouble();
    renderDelivery(delivery);
    const form = await screen.findByRole('form', { name: 'Delivery source' });
    fireEvent.change(within(form).getByLabelText('Production environments'), {
      target: { value: ' , ' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Save source' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Name at least one production');
    expect(delivery.setSource).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText('Production environments'), {
      target: { value: 'production, prod-eu' },
    });
    fireEvent.change(within(form).getByLabelText('Deploy workflows'), {
      target: { value: 'Deploy, Release' },
    });
    fireEvent.change(within(form).getByLabelText('Cadence'), { target: { value: 'hourly' } });
    fireEvent.click(within(form).getByLabelText('Read from GitHub'));
    fireEvent.click(within(form).getByRole('button', { name: 'Save source' }));
    await waitFor(() =>
      expect(delivery.setSource).toHaveBeenCalledWith(TEST_PROJECT.id, {
        enabled: false,
        cadence: 'hourly',
        productionEnvironments: ['production', 'prod-eu'],
        deployWorkflows: ['Deploy', 'Release'],
      }),
    );
    expect(await screen.findByText('Delivery source saved')).toBeInTheDocument();
  });

  it('says why the source was not saved, and when it could not be read', async () => {
    const { unmount } = renderDelivery(
      deliveryDouble({
        setSource: vi.fn(async () => {
          throw serverRefusal('Invalid delivery source', 400);
        }),
      }),
    );
    const form = await screen.findByRole('form', { name: 'Delivery source' });
    fireEvent.click(within(form).getByRole('button', { name: 'Save source' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Invalid delivery source');
    unmount();
    renderDelivery(
      deliveryDouble({
        getSource: vi.fn(async () => {
          throw serverRefusal('source unreadable');
        }),
      }),
    );
    expect(await screen.findByText(/source unreadable/u)).toBeInTheDocument();
  });
});

describe('listField', () => {
  it('splits on commas and drops empty entries', () => {
    expect(listField(' a, ,b ,')).toEqual(['a', 'b']);
    expect(listField('')).toEqual([]);
  });
});
