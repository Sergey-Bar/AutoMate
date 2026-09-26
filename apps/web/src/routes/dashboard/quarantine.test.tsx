import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QuarantinePage } from './quarantine.js';
import type { ApiClient, QuarantineEntry } from '../../lib/api.js';

describe('QuarantinePage', () => {
  const mockEntries: QuarantineEntry[] = [
    {
      id: 'q-1',
      testTitle: 'flaky test',
      testFile: 'flaky.test.ts',
      reason: 'timeout issues',
      quarantinedAt: '2026-05-05T10:00:00.000Z',
    },
  ];

  it('renders loading state initially', () => {
    const mockApi = {
      getQuarantine: vi.fn(() => new Promise<QuarantineEntry[]>(() => {})),
    } as unknown as ApiClient;

    render(<QuarantinePage api={mockApi} />);
    expect(screen.getByTestId('quarantine-loading')).toBeInTheDocument();
  });

  it('renders error state if API fails', async () => {
    const mockApi = {
      getQuarantine: vi.fn(() => Promise.reject(new Error('Failed API'))),
    } as unknown as ApiClient;

    render(<QuarantinePage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('quarantine-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Failed API')).toBeInTheDocument();
  });

  it('renders empty state when no tests quarantined', async () => {
    const mockApi = {
      getQuarantine: vi.fn(() => Promise.resolve([])),
    } as unknown as ApiClient;

    render(<QuarantinePage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('quarantine-empty')).toBeInTheDocument();
    });
  });

  it('renders list of quarantined tests', async () => {
    const mockApi = {
      getQuarantine: vi.fn(() => Promise.resolve(mockEntries)),
    } as unknown as ApiClient;

    render(<QuarantinePage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('quarantine-list')).toBeInTheDocument();
    });

    expect(screen.getByText('flaky test')).toBeInTheDocument();
    expect(screen.getByText('flaky.test.ts')).toBeInTheDocument();
    expect(screen.getByText('Reason: timeout issues')).toBeInTheDocument();
  });

  it('allows adding a new quarantine entry', async () => {
    const newEntry: QuarantineEntry = {
      id: 'q-2',
      testTitle: 'new flaky test',
      testFile: 'new.test.ts',
      reason: null,
      quarantinedAt: '2026-05-05T10:01:00.000Z',
    };

    const mockApi = {
      getQuarantine: vi.fn(() => Promise.resolve(mockEntries)),
      addQuarantine: vi.fn(() => Promise.resolve(newEntry)),
    } as unknown as ApiClient;

    render(<QuarantinePage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('quarantine-list')).toBeInTheDocument();
    });

    // Open form
    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    expect(screen.getByTestId('quarantine-form')).toBeInTheDocument();

    // Fill form
    fireEvent.change(screen.getByTestId('input-test-title'), {
      target: { value: 'new flaky test' },
    });
    fireEvent.change(screen.getByTestId('input-test-file'), { target: { value: 'new.test.ts' } });

    // Submit
    fireEvent.click(screen.getByTestId('submit-quarantine-btn'));

    await waitFor(() => {
      expect(mockApi.addQuarantine).toHaveBeenCalledWith({
        testTitle: 'new flaky test',
        testFile: 'new.test.ts',
        reason: undefined,
      });
    });

    // Should be added to list
    expect(screen.getByText('new flaky test')).toBeInTheDocument();
  });
});
