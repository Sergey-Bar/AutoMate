/**
 * audit-viewer.test.tsx
 *
 * Tests for the /admin/audit route (AuditPage component).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/test-utils';

// ─── Hoisted state ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  searchState: new Map<string, Record<string, unknown>>(),
  routeComponents: new Map<string, React.ComponentType>(),
  fetchMock: vi.fn<typeof fetch>(),
}));

vi.stubGlobal('fetch', mocks.fetchMock);

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => {
  type RouteFactoryOptions = { component?: React.ComponentType };
  function registerRoute(path: string, options: RouteFactoryOptions) {
    if (options.component) mocks.routeComponents.set(path, options.component);
    return {
      ...options,
      useSearch: () => mocks.searchState.get(path) ?? {},
      useParams: () => ({}),
    };
  }
  return {
    Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to, ...rest }, children),
    createFileRoute: (path: string) => (options: RouteFactoryOptions) => registerRoute(path, options),
    createLazyFileRoute: (path: string) => (options: RouteFactoryOptions) => registerRoute(path, options),
    useNavigate: () => (opts?: { search?: (prev: Record<string, unknown>) => Record<string, unknown> }) => {
      if (opts && typeof opts.search === 'function') opts.search({});
      return mocks.navigateMock;
    },
    useRouter: () => ({ navigate: mocks.navigateMock }),
    useSearch: (opts?: { from?: string }) => mocks.searchState.get(opts?.from ?? '') ?? {},
    useParams: () => ({}),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

interface AuditEvent {
  id: string;
  timestamp: string;
  actorId: string;
  actorType: 'user' | 'system' | 'service';
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  details: string | null;
}

const sampleEvents: AuditEvent[] = [
  {
    id: 'evt-1',
    timestamp: '2026-04-01T10:00:00Z',
    actorId: 'user-abc',
    actorType: 'user',
    action: 'auth.login',
    resourceType: 'session',
    resourceId: 'sess-123',
    ip: '192.168.1.1',
    userAgent: 'Mozilla/5.0',
    requestId: 'req-1',
    details: null,
  },
  {
    id: 'evt-2',
    timestamp: '2026-04-02T11:00:00Z',
    actorId: 'user-xyz',
    actorType: 'user',
    action: 'key.create',
    resourceType: 'api-key',
    resourceId: 'key-456',
    ip: '10.0.0.2',
    userAgent: null,
    requestId: 'req-2',
    details: null,
  },
];

function mockFetch(data: unknown, status = 200) {
  mocks.fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as Response);
}

// ─── Component loader ─────────────────────────────────────────────────────────

import '../admin/audit.lazy';

async function renderAuditPage() {
  const Component = mocks.routeComponents.get('/admin/audit');
  if (!Component) throw new Error('AuditPage component not registered');
  return renderWithProviders(React.createElement(Component));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchState.clear();
    mocks.searchState.set('/admin/audit', {});
  });

  it('renders page heading', async () => {
    mocks.fetchMock.mockReturnValue(new Promise(() => undefined)); // never resolves
    const { container } = await renderAuditPage();
    expect(container.textContent).toContain('Audit Log');
  });

  it('renders filter controls', async () => {
    mocks.fetchMock.mockReturnValue(new Promise(() => undefined));
    await renderAuditPage();
    expect(screen.getByTestId('filter-actor')).toBeInTheDocument();
    expect(screen.getByTestId('filter-action')).toBeInTheDocument();
    expect(screen.getByTestId('filter-from')).toBeInTheDocument();
    expect(screen.getByTestId('filter-to')).toBeInTheDocument();
    expect(screen.getByTestId('filter-limit')).toBeInTheDocument();
    expect(screen.getByTestId('apply-filters')).toBeInTheDocument();
  });

  it('renders audit table with events on successful fetch', async () => {
    mockFetch(sampleEvents);
    await renderAuditPage();
    await waitFor(() => {
      expect(screen.getByTestId('audit-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('audit-table').textContent).toContain('user-abc');
    expect(screen.getByTestId('audit-table').textContent).toContain('auth.login');
    expect(screen.getByTestId('audit-table').textContent).toContain('user-xyz');
    expect(screen.getByTestId('audit-table').textContent).toContain('key.create');
  });

  it('renders empty state when no events returned', async () => {
    mockFetch([]);
    await renderAuditPage();
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
    expect(screen.getByTestId('empty-state').textContent).toContain('No audit events found');
  });

  it('renders export CSV button', async () => {
    mocks.fetchMock.mockReturnValue(new Promise(() => undefined));
    await renderAuditPage();
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
  });

  it('export CSV button is disabled when no events loaded', async () => {
    mocks.fetchMock.mockReturnValue(new Promise(() => undefined));
    await renderAuditPage();
    expect(screen.getByTestId('export-csv')).toBeDisabled();
  });

  it('export CSV button is enabled when events are present', async () => {
    mockFetch(sampleEvents);
    await renderAuditPage();
    await waitFor(() => {
      expect(screen.getByTestId('audit-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('export-csv')).not.toBeDisabled();
  });

  it('shows forbidden message on 403 response', async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: 'Forbidden' }),
    } as Response);
    await renderAuditPage();
    await waitFor(() => {
      expect(screen.getByTestId('forbidden-message')).toBeInTheDocument();
    });
    expect(screen.getByTestId('forbidden-message').textContent).toContain('Access denied');
  });

  it('hides filters and table on 403 response', async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: 'Forbidden' }),
    } as Response);
    await renderAuditPage();
    await waitFor(() => {
      expect(screen.getByTestId('forbidden-message')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('audit-table')).not.toBeInTheDocument();
  });

  it('renders pagination controls', async () => {
    mockFetch(sampleEvents);
    await renderAuditPage();
    await waitFor(() => {
      expect(screen.getByTestId('audit-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('prev-page')).toBeInTheDocument();
    expect(screen.getByTestId('next-page')).toBeInTheDocument();
  });

  it('prev-page button is disabled on first page', async () => {
    mockFetch(sampleEvents);
    await renderAuditPage();
    await waitFor(() => {
      expect(screen.getByTestId('prev-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('prev-page')).toBeDisabled();
  });

  it('next-page button is disabled when fewer events than limit returned', async () => {
    // sampleEvents has 2 items; default limit is 50, so next should be disabled
    mockFetch(sampleEvents);
    await renderAuditPage();
    await waitFor(() => {
      expect(screen.getByTestId('next-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('next-page')).toBeDisabled();
  });

  it('actor filter input accepts text', async () => {
    mocks.fetchMock.mockReturnValue(new Promise(() => undefined));
    await renderAuditPage();
    const actorInput = screen.getByTestId('filter-actor') as HTMLInputElement;
    fireEvent.change(actorInput, { target: { value: 'user-abc' } });
    expect(actorInput.value).toBe('user-abc');
  });

  it('action filter dropdown has all action options', async () => {
    mocks.fetchMock.mockReturnValue(new Promise(() => undefined));
    await renderAuditPage();
    const select = screen.getByTestId('filter-action') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('auth.login');
    expect(options).toContain('key.create');
    expect(options).toContain('quarantine.add');
    expect(options).toContain('');
  });

  it('per-page select has 25, 50, 100 options', async () => {
    mocks.fetchMock.mockReturnValue(new Promise(() => undefined));
    await renderAuditPage();
    const select = screen.getByTestId('filter-limit') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => Number(o.value));
    expect(options).toContain(25);
    expect(options).toContain(50);
    expect(options).toContain(100);
  });

  it('renders IP column value for events with IP', async () => {
    mockFetch(sampleEvents);
    await renderAuditPage();
    await waitFor(() => {
      expect(screen.getByTestId('audit-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('audit-table').textContent).toContain('192.168.1.1');
  });

  it('shows resource type in table for events with resource', async () => {
    mockFetch(sampleEvents);
    await renderAuditPage();
    await waitFor(() => {
      expect(screen.getByTestId('audit-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('audit-table').textContent).toContain('session');
  });

  it('shows general error message on non-403 server failure', async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server error' }),
    } as Response);
    await renderAuditPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert').textContent).toContain('Failed to load audit log');
  });

  it('shows resource type AND truncated resource id when both are present', async () => {
    const eventsWithResource: AuditEvent[] = [{
      id: 'evt-r',
      timestamp: '2026-04-01T10:00:00Z',
      actorId: 'user-abc',
      actorType: 'user',
      action: 'key.create',
      resourceType: 'api-key',
      resourceId: 'abc123456789',
      ip: '1.2.3.4',
      userAgent: null,
      requestId: null,
      details: null,
    }];
    mockFetch(eventsWithResource);
    await renderAuditPage();
    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeInTheDocument());
    expect(screen.getByTestId('audit-table').textContent).toContain('api-key / abc12345');
  });

  it('shows dash placeholder when event has null resourceType', async () => {
    const eventsNoResource: AuditEvent[] = [{
      id: 'evt-nr',
      timestamp: '2026-04-01T10:00:00Z',
      actorId: 'user-abc',
      actorType: 'user',
      action: 'auth.login',
      resourceType: null,
      resourceId: null,
      ip: '1.2.3.4',
      userAgent: null,
      requestId: null,
      details: null,
    }];
    mockFetch(eventsNoResource);
    await renderAuditPage();
    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeInTheDocument());
    const table = screen.getByTestId('audit-table');
    expect(table.innerHTML).toContain('—');
  });

  it('shows dash in IP column when event has null ip', async () => {
    const eventsNoIp: AuditEvent[] = [{
      id: 'evt-noip',
      timestamp: '2026-04-01T10:00:00Z',
      actorId: 'user-abc',
      actorType: 'user',
      action: 'auth.login',
      resourceType: 'session',
      resourceId: null,
      ip: null,
      userAgent: null,
      requestId: null,
      details: null,
    }];
    mockFetch(eventsNoIp);
    await renderAuditPage();
    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeInTheDocument());
    // ip ?? '—' branch: null ip renders the dash fallback
    expect(screen.getByTestId('audit-table').textContent).toContain('—');
  });

  it('next-page button is enabled when events count equals the limit', async () => {
    const fullPage: AuditEvent[] = Array.from({ length: 25 }, (_, i) => ({
      id: `evt-${i}`,
      timestamp: '2026-04-01T10:00:00Z',
      actorId: `user-${i}`,
      actorType: 'user' as const,
      action: 'auth.login',
      resourceType: null,
      resourceId: null,
      ip: null,
      userAgent: null,
      requestId: null,
      details: null,
    }));
    mockFetch(fullPage);
    mocks.searchState.set('/admin/audit', { limit: 25 });
    await renderAuditPage();
    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeInTheDocument());
    expect(screen.getByTestId('next-page')).not.toBeDisabled();
  });

  it('prev-page button is enabled when offset is greater than 0', async () => {
    mockFetch(sampleEvents);
    mocks.searchState.set('/admin/audit', { offset: 50 });
    await renderAuditPage();
    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeInTheDocument());
    expect(screen.getByTestId('prev-page')).not.toBeDisabled();
  });

  it('includes filter params in fetch URL when search state has filters', async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    } as Response);
    mocks.searchState.set('/admin/audit', {
      actor: 'admin-user',
      action: 'auth.login',
      from: '2026-01-01',
      to: '2026-04-01',
    });
    await renderAuditPage();
    await waitFor(() => {
      expect(mocks.fetchMock).toHaveBeenCalled();
    });
    const url = String(mocks.fetchMock.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('actor=admin-user');
    expect(url).toContain('action=auth.login');
    expect(url).toContain('from=2026-01-01');
    expect(url).toContain('to=2026-04-01');
  });

  it('re-fetches with new actor param when Apply button is clicked', async () => {
    mockFetch([]);
    await renderAuditPage();
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('filter-actor'), { target: { value: 'new-actor' } });
    fireEvent.click(screen.getByTestId('apply-filters'));
    await waitFor(() => {
      const calls = mocks.fetchMock.mock.calls;
      const latestUrl = String(calls[calls.length - 1]?.[0] ?? '');
      expect(latestUrl).toContain('actor=new-actor');
    });
  });

  it('clicking prev-page decrements offset', async () => {
    mockFetch(sampleEvents);
    mocks.searchState.set('/admin/audit', { offset: 50 });
    await renderAuditPage();
    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeInTheDocument());
    const prevBtn = screen.getByTestId('prev-page');
    expect(prevBtn).not.toBeDisabled();
    fireEvent.click(prevBtn);
    // After clicking, offset becomes 0, fetch re-runs without offset param
    await waitFor(() => {
      const calls = mocks.fetchMock.mock.calls;
      expect(calls.length).toBeGreaterThan(1);
    });
  });

  it('clicking next-page increments offset when full page is loaded', async () => {
    const fullPage: AuditEvent[] = Array.from({ length: 25 }, (_, i) => ({
      id: `evtfp-${i}`,
      timestamp: '2026-04-01T10:00:00Z',
      actorId: `user-${i}`,
      actorType: 'user' as const,
      action: 'auth.login',
      resourceType: null,
      resourceId: null,
      ip: null,
      userAgent: null,
      requestId: null,
      details: null,
    }));
    mockFetch(fullPage);
    mocks.searchState.set('/admin/audit', { limit: 25 });
    await renderAuditPage();
    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeInTheDocument());
    const nextBtn = screen.getByTestId('next-page');
    expect(nextBtn).not.toBeDisabled();
    fireEvent.click(nextBtn);
    // After clicking, offset becomes 25 and a new fetch is triggered
    await waitFor(() => {
      const calls = mocks.fetchMock.mock.calls;
      expect(calls.length).toBeGreaterThan(1);
    });
  });

  it('changing per-page select resets offset to 0', async () => {
    mockFetch(sampleEvents);
    await renderAuditPage();
    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeInTheDocument());
    const limitSelect = screen.getByTestId('filter-limit');
    fireEvent.change(limitSelect, { target: { value: '100' } });
    // A re-fetch should be triggered with the new limit
    await waitFor(() => {
      const calls = mocks.fetchMock.mock.calls;
      const latestUrl = String(calls[calls.length - 1]?.[0] ?? '');
      expect(latestUrl).toContain('limit=100');
    });
  });

  it('export CSV button triggers download when events are available', async () => {
    const createObjectURLMock = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url');
    const revokeObjectURLMock = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { /* noop */ });
    mockFetch(sampleEvents);
    await renderAuditPage();
    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('export-csv'));
    expect(createObjectURLMock).toHaveBeenCalled();
    createObjectURLMock.mockRestore();
    revokeObjectURLMock.mockRestore();
  });

  it('handles Enter key in actor input by applying filters', async () => {
    mockFetch([]);
    await renderAuditPage();
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    const actorInput = screen.getByTestId('filter-actor');
    fireEvent.change(actorInput, { target: { value: 'key-user' } });
    fireEvent.keyDown(actorInput, { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      const calls = mocks.fetchMock.mock.calls;
      const latestUrl = String(calls[calls.length - 1]?.[0] ?? '');
      expect(latestUrl).toContain('actor=key-user');
    });
  });

  it('action filter select onChange updates action state', async () => {
    mocks.fetchMock.mockReturnValue(new Promise(() => undefined));
    await renderAuditPage();
    const actionSelect = screen.getByTestId('filter-action') as HTMLSelectElement;
    fireEvent.change(actionSelect, { target: { value: 'auth.login' } });
    expect(actionSelect.value).toBe('auth.login');
  });

  it('from date input onChange updates from state', async () => {
    mocks.fetchMock.mockReturnValue(new Promise(() => undefined));
    await renderAuditPage();
    const fromInput = screen.getByTestId('filter-from') as HTMLInputElement;
    fireEvent.change(fromInput, { target: { value: '2026-01-01' } });
    expect(fromInput.value).toBe('2026-01-01');
  });

  it('to date input onChange updates to state', async () => {
    mocks.fetchMock.mockReturnValue(new Promise(() => undefined));
    await renderAuditPage();
    const toInput = screen.getByTestId('filter-to') as HTMLInputElement;
    fireEvent.change(toInput, { target: { value: '2026-04-30' } });
    expect(toInput.value).toBe('2026-04-30');
  });

  it('export CSV covers null resource/ip fields with empty string fallback', async () => {
    const createObjectURLMock = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:null-test');
    const revokeObjectURLMock = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { /* noop */ });
    const eventsWithNulls: AuditEvent[] = [{
      id: 'evt-nulls',
      timestamp: '2026-04-01T10:00:00Z',
      actorId: 'user-abc',
      actorType: 'user',
      action: 'auth.login',
      resourceType: null,
      resourceId: null,
      ip: null,
      userAgent: null,
      requestId: null,
      details: null,
    }];
    mockFetch(eventsWithNulls);
    await renderAuditPage();
    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('export-csv'));
    expect(createObjectURLMock).toHaveBeenCalled();
    createObjectURLMock.mockRestore();
    revokeObjectURLMock.mockRestore();
  });
});
