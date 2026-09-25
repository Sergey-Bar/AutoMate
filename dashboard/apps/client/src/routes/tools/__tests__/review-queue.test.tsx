import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/test-utils';
import { useFeatureStore } from '@/store/featureStore';

// Hoist mocks
const mocks = vi.hoisted(() => ({
  fetchMock: vi.fn<typeof fetch>(),
  routeComponents: new Map<string, React.ComponentType>(),
}));

vi.stubGlobal('fetch', mocks.fetchMock);

// Mock @tanstack/react-router
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  type RouteFactoryOptions = { component?: React.ComponentType };
  function registerRoute(path: string, options: RouteFactoryOptions) {
    if (options.component) mocks.routeComponents.set(path, options.component);
    return { ...options, useSearch: () => ({}), useParams: () => ({}) };
  }
  return {
    ...actual,
    createFileRoute: (path: string) => (options: RouteFactoryOptions) => registerRoute(path, options),
    createLazyFileRoute: (path: string) => (options: RouteFactoryOptions) => registerRoute(path, options),
    useNavigate: () => vi.fn(),
    useRouter: () => ({ navigate: vi.fn() }),
  };
});

// Import the lazy route module to register the component
import '../review-queue.lazy';

const mockSuggestions = [
  {
    id: 'sugg-1',
    sessionId: 'session-123',
    sourceType: 'conversation',
    sourceMetadata: { messageId: 'msg-1' },
    status: 'draft',
    originalContent: 'test("example", async () => {});',
    editedContent: null,
    warnings: [],
    createdAt: new Date('2026-05-01T10:00:00Z').toISOString(),
    updatedAt: new Date('2026-05-01T10:00:00Z').toISOString(),
  },
  {
    id: 'sugg-2',
    sessionId: null,
    sourceType: 'github_pr',
    sourceMetadata: { prUrl: 'https://github.com/test/repo/pull/1' },
    status: 'draft',
    originalContent: 'test("pr test", async () => {});',
    editedContent: null,
    warnings: ['Missing assertion'],
    createdAt: new Date('2026-05-02T10:00:00Z').toISOString(),
    updatedAt: new Date('2026-05-02T10:00:00Z').toISOString(),
  }
];

describe('ReviewQueuePage', () => {
  const renderComponent = () => {
    const Component = mocks.routeComponents.get('/tools/review-queue');
    if (!Component) throw new Error('Component not registered');
    return renderWithProviders(<Component />);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useFeatureStore.setState({ flags: { 'ai-test-gen-v2': true }, loaded: true });

    mocks.fetchMock.mockImplementation(async (req) => {
      const url = req instanceof Request ? req.url : req;
      const urlStr = url.toString();
      
      if (urlStr.includes('/api/generated-test-suggestions')) {
        if (req instanceof Request && req.method === 'PATCH') {
          return { ok: true, json: async () => ({ success: true }) } as Response;
        }
        return {
          ok: true,
          json: async () => mockSuggestions,
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });
  });

  it('renders disabled page when feature flag is off', () => {
    useFeatureStore.setState({ flags: { 'ai-test-gen-v2': false }, loaded: true });
    renderComponent();
    expect(screen.getByText(/is not enabled/i)).toBeInTheDocument();
  });

  it('renders queue and fetches suggestions', async () => {
    renderComponent();
    
    expect(screen.getByText('Review Queue')).toBeInTheDocument();
    expect(screen.getByText('Loading...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('session-123')).toBeInTheDocument();
      expect(screen.getByText('https://github.com/test/repo/pull/1')).toBeInTheDocument();
    });

    // Check warning is displayed for the second suggestion
    expect(screen.getByText(/1 warning/i)).toBeInTheDocument();
  });

  it('selects a suggestion and displays details', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('session-123'));

    // Detail view should appear
    expect(screen.getByText('Review Suggestion')).toBeInTheDocument();
    expect(screen.getByText('Generated Content')).toBeInTheDocument();
    expect(screen.getByText('test("example", async () => {});')).toBeInTheDocument();
    expect(screen.getByText('ID: sugg-1...')).toBeInTheDocument();
    
    // Actions
    expect(screen.getByText('Accept')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  it('accepts a suggestion', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('session-123'));
    
    const acceptBtn = screen.getByText('Accept');
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(mocks.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/generated-test-suggestions/sugg-1'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'accepted' })
        })
      );
    });
  });

  it('rejects a suggestion', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('session-123'));
    
    const rejectBtn = screen.getByText('Reject');
    fireEvent.click(rejectBtn);

    await waitFor(() => {
      expect(mocks.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/generated-test-suggestions/sugg-1'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'rejected' })
        })
      );
    });
  });

  it('edits a suggestion content', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('session-123'));
    
    fireEvent.click(screen.getByText('Edit'));

    const textarea = screen.getByDisplayValue('test("example", async () => {});');
    fireEvent.change(textarea, { target: { value: 'edited content' } });

    fireEvent.click(screen.getByText('Save Edit'));

    await waitFor(() => {
      expect(mocks.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/generated-test-suggestions/sugg-1'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'edited', editedContent: 'edited content' })
        })
      );
    });
  });

  it('handles empty state', async () => {
    mocks.fetchMock.mockImplementation(async () => {
      return { ok: true, json: async () => [] } as Response;
    });

    renderComponent();
    
    await waitFor(() => {
      expect(screen.getByText('Queue is empty')).toBeInTheDocument();
    });
  });

  it('renders download button in detail view', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('session-123'));

    const downloadBtn = screen.getByTitle('Download as file');
    expect(downloadBtn).toBeInTheDocument();
  });

  it('triggers file download when download button is clicked', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('session-123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('session-123'));

    const createObjectURL = vi.fn().mockReturnValue('blob:test-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    const mockAnchor = { href: '', download: '', click: vi.fn() };
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as unknown as HTMLElement);
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    const removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

    const downloadBtn = screen.getByTitle('Download as file');
    fireEvent.click(downloadBtn);

    expect(createObjectURL).toHaveBeenCalled();
    expect(mockAnchor.download).toBe('suggestion-sugg-1.spec.ts');
    expect(mockAnchor.click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');

    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });
});
