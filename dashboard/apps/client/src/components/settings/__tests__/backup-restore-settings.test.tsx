/// <reference types="@testing-library/jest-dom" />

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, waitFor, userEvent } from '../../../test/test-utils';
import { BackupRestoreSettings } from '../BackupRestoreSettings';

vi.mock('framer-motion', async () => {
  const ReactModule = await import('react');
  return {
    motion: new Proxy({}, {
      get: (_target: unknown, prop: string) => {
        return ({ initial: _initial, animate: _animate, exit: _exit, variants: _variants, transition: _transition, ...rest }: Record<string, unknown>) => {
          const validTags = ['div', 'span', 'button', 'p', 'li', 'section', 'a', 'header', 'footer', 'main', 'aside', 'label'];
          const Tag = typeof prop === 'string' && validTags.includes(prop) ? prop : 'div';
          return ReactModule.createElement(Tag, rest);
        };
      },
    }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => ReactModule.createElement(React.Fragment, null, children),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function blobResponse(): Response {
  return new Response(new Blob(['fake db data'], { type: 'application/octet-stream' }), { status: 200 });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(jsonResponse({}));
});

describe('BackupRestoreSettings', () => {
  it('renders database info section and backup button', async () => {
    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/settings/db-stats') {
        return jsonResponse({ sizeBytes: 1048576, sizeMB: '1.00', pageCount: 256, pageSize: 4096 });
      }
      return jsonResponse({});
    });

    renderWithProviders(<BackupRestoreSettings />);

    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('Backup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download/i })).toBeInTheDocument();
    expect(await screen.findByText('1.00')).toBeInTheDocument();
  });

  it('shows dash when db stats not loaded', () => {
    mockFetch.mockResolvedValue(jsonResponse(null));
    renderWithProviders(<BackupRestoreSettings />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('triggers backup download and shows success toast', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();

    // Mock createObjectURL and revokeObjectURL
    const createObjectUrlMock = vi.fn(() => 'blob:http://localhost/fake-blob');
    const revokeObjectUrlMock = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: createObjectUrlMock, revokeObjectURL: revokeObjectUrlMock });

    const clickSpy = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === 'a') {
        vi.spyOn(el, 'click').mockImplementation(clickSpy);
      }
      return el;
    });

    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/settings/backup') return blobResponse();
      if (String(input) === '/api/settings/db-stats') return jsonResponse({ sizeBytes: 0, sizeMB: '0.00', pageCount: 0, pageSize: 4096 });
      return jsonResponse({});
    });

    renderWithProviders(<BackupRestoreSettings />);

    await user.click(await screen.findByRole('button', { name: /Download/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Backup downloaded');
    });

    vi.restoreAllMocks();
  });

  it('shows error toast when backup fails', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();

    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/settings/backup') return jsonResponse({ error: 'server error' }, 500);
      if (String(input) === '/api/settings/db-stats') return jsonResponse({ sizeBytes: 0, sizeMB: '0.00', pageCount: 0, pageSize: 4096 });
      return jsonResponse({});
    });

    renderWithProviders(<BackupRestoreSettings />);

    await user.click(await screen.findByRole('button', { name: /Download/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Backup failed');
    });
  });

  it('selects a file and shows Restore button', async () => {
    const user = userEvent.setup();

    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/settings/db-stats') return jsonResponse({ sizeBytes: 0, sizeMB: '0.00', pageCount: 0, pageSize: 4096 });
      return jsonResponse({});
    });

    renderWithProviders(<BackupRestoreSettings />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const file = new File(['db content'], 'backup.db', { type: 'application/octet-stream' });
    await user.upload(fileInput, file);

    expect(screen.getByText('backup.db')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restore/i })).toBeInTheDocument();
  });

  it('shows confirmation dialog when Restore is clicked', async () => {
    const user = userEvent.setup();

    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/settings/db-stats') return jsonResponse({ sizeBytes: 0, sizeMB: '0.00', pageCount: 0, pageSize: 4096 });
      return jsonResponse({});
    });

    renderWithProviders(<BackupRestoreSettings />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['db content'], 'backup.db', { type: 'application/octet-stream' });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole('button', { name: /^Restore$/i }));

    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Yes, Replace Database/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('cancels confirmation dialog when Cancel is clicked', async () => {
    const user = userEvent.setup();

    mockFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/settings/db-stats') return jsonResponse({ sizeBytes: 0, sizeMB: '0.00', pageCount: 0, pageSize: 4096 });
      return jsonResponse({});
    });

    renderWithProviders(<BackupRestoreSettings />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['db content'], 'backup.db', { type: 'application/octet-stream' });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole('button', { name: /^Restore$/i }));
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Are you sure?')).not.toBeInTheDocument();
  });

  it('submits restore and shows success toast', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();

    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/settings/db-stats') return jsonResponse({ sizeBytes: 0, sizeMB: '0.00', pageCount: 0, pageSize: 4096 });
      if (url === '/api/settings/restore' && method === 'POST') return jsonResponse({ message: 'Database restored. Please restart the server.' });
      return jsonResponse({});
    });

    renderWithProviders(<BackupRestoreSettings />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['db content'], 'backup.db', { type: 'application/octet-stream' });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole('button', { name: /^Restore$/i }));
    await user.click(screen.getByRole('button', { name: /Yes, Replace Database/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Database restored. Please restart the server.');
    });
  });

  it('shows error toast when restore fails', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();

    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/settings/db-stats') return jsonResponse({ sizeBytes: 0, sizeMB: '0.00', pageCount: 0, pageSize: 4096 });
      if (url === '/api/settings/restore' && method === 'POST') return jsonResponse({ error: 'Invalid format' }, 400);
      return jsonResponse({});
    });

    renderWithProviders(<BackupRestoreSettings />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['bad data'], 'bad.db', { type: 'application/octet-stream' });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole('button', { name: /^Restore$/i }));
    await user.click(screen.getByRole('button', { name: /Yes, Replace Database/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });
});
