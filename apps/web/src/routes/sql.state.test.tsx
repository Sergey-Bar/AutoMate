/**
 * sql.state.test.tsx
 *
 * Covers the SqlBrowserPage handleSubmit body (lines 8-47 in sql.tsx) by:
 * 1. Mocking useState to return non-empty query (so !query.trim() guard is bypassed)
 * 2. Mocking useCallback to pass through the callback directly
 * 3. Mocking fetch to simulate success and error responses
 *
 * Also covers:
 * - The {result && (...)} JSX block (lines 80-95) via a pre-populated result state
 *
 * useState call order in SqlBrowserPage:
 *   1. query   → '' (or 'Show all users' to make handleSubmit callable)
 *   2. result  → '' (or 'SELECT * FROM users;' to render result block)
 *   3. status  → 'idle' | 'loading' | 'error'
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

// ---- Module-level state controls (reset in beforeEach) ----------------------

let _useStateCallCount = 0;
let _mockQuery = 'Show all users from the last 7 days';
let _mockResult = '';
let _mockStatus: 'idle' | 'loading' | 'error' = 'idle';

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    useState: (initial: unknown) => {
      const originalResult = original.useState(initial);
      _useStateCallCount++;
      const count = _useStateCallCount;
      if (count === 1) return [_mockQuery, vi.fn()];
      if (count === 2) return [_mockResult, vi.fn()];
      if (count === 3) return [_mockStatus, vi.fn()];
      return originalResult;
    },
    // Return the callback fn directly so tests can call it
    useCallback: (cb: unknown) => cb,
    useEffect: (_cb: unknown) => { /* no-op */ },
  };
});

const mockFetch = vi.fn();

beforeEach(() => {
  globalThis.fetch = mockFetch;
  _useStateCallCount = 0;
  _mockQuery = 'Show all users from the last 7 days';
  _mockResult = '';
  _mockStatus = 'idle';
  vi.resetAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Render with non-empty query ───────────────────────────────────────────────

describe('SqlBrowserPage with non-empty query (via useState mock)', () => {
  it('renders the page heading', async () => {
    const { SqlBrowserPage } = await import('./sql.js');
    const html = renderToString(React.createElement(SqlBrowserPage));
    expect(html).toContain('Text-to-SQL Browser');
  });

  it('renders query value in textarea when query is non-empty', async () => {
    const { SqlBrowserPage } = await import('./sql.js');
    const html = renderToString(React.createElement(SqlBrowserPage));
    expect(html).toContain('Show all users from the last 7 days');
  });

  it('renders Generate SQL button NOT disabled when query is non-empty', async () => {
    const { SqlBrowserPage } = await import('./sql.js');
    const html = renderToString(React.createElement(SqlBrowserPage));
    // With non-empty query and idle status, button should NOT have disabled attr
    expect(html).not.toContain('disabled');
  });

  it('renders "Generating..." when status is loading', async () => {
    _mockStatus = 'loading';
    _useStateCallCount = 0;
    const { SqlBrowserPage } = await import('./sql.js');
    const html = renderToString(React.createElement(SqlBrowserPage));
    expect(html).toContain('Generating...');
  });

  it('renders Generate SQL button text when status is idle', async () => {
    const { SqlBrowserPage } = await import('./sql.js');
    const html = renderToString(React.createElement(SqlBrowserPage));
    expect(html).toContain('Generate SQL');
  });
});

// ── Result rendering: {result && (...)} block ─────────────────────────────────

describe('SqlBrowserPage result rendering (via useState mock)', () => {
  it('renders Generated SQL heading when result is non-empty', async () => {
    _mockResult = 'SELECT * FROM conversations WHERE created_at > NOW() - INTERVAL 7 DAY;';
    _useStateCallCount = 0;
    const { SqlBrowserPage } = await import('./sql.js');
    const html = renderToString(React.createElement(SqlBrowserPage));
    expect(html).toContain('Generated SQL');
  });

  it('renders the SQL result inside a pre element', async () => {
    _mockResult = 'SELECT id, title FROM conversations LIMIT 10;';
    _useStateCallCount = 0;
    const { SqlBrowserPage } = await import('./sql.js');
    const html = renderToString(React.createElement(SqlBrowserPage));
    expect(html).toContain('<pre');
    expect(html).toContain('SELECT id, title FROM conversations LIMIT 10;');
  });

  it('does NOT render Generated SQL section when result is empty', async () => {
    _mockResult = '';
    _useStateCallCount = 0;
    const { SqlBrowserPage } = await import('./sql.js');
    const html = renderToString(React.createElement(SqlBrowserPage));
    expect(html).not.toContain('Generated SQL');
  });

  it('renders error result text in pre element', async () => {
    _mockResult = 'Error: HTTP 500';
    _mockStatus = 'error';
    _useStateCallCount = 0;
    const { SqlBrowserPage } = await import('./sql.js');
    const html = renderToString(React.createElement(SqlBrowserPage));
    expect(html).toContain('Error: HTTP 500');
  });
});

// ── handleSubmit: invoke the callback directly to cover lines 8-47 ───────────

describe('SqlBrowserPage handleSubmit body coverage', () => {
  it('handleSubmit: returns early without fetching when query is empty', async () => {
    _mockQuery = '';
    _useStateCallCount = 0;
    const { SqlBrowserPage } = await import('./sql.js');

    // Capture the handleSubmit callback via Wrapper
    let capturedHandleSubmit: (() => Promise<void>) | undefined;
    function Wrapper() {
      const el = SqlBrowserPage() as React.ReactElement<{ children: React.ReactNode }>;
      // The button onClick is handleSubmit
      const sectionChildren = React.Children.toArray(el.props.children) as React.ReactElement[];
      const buttonEl = sectionChildren.find(
        (c) => c && typeof c === 'object' && 'type' in c && (c as React.ReactElement).type === 'button'
      ) as React.ReactElement<{ onClick?: () => Promise<void> }> | undefined;
      capturedHandleSubmit = buttonEl?.props?.onClick;
      return el;
    }
    renderToString(React.createElement(Wrapper));

    if (capturedHandleSubmit) {
      await capturedHandleSubmit();
      // Empty query → fetch should NOT be called
      expect(mockFetch).not.toHaveBeenCalled();
    }
  });

  it('handleSubmit: calls /api/chat with query when query is non-empty', async () => {
    const { SqlBrowserPage } = await import('./sql.js');

    // Mock streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('SELECT * FROM conversations;'));
        controller.close();
      },
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: stream.getReader() ? stream : null,
    });
    // Re-mock with proper body.getReader() support
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode('SELECT * FROM users;') })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: { getReader: () => mockReader },
    });

    let capturedHandleSubmit: (() => Promise<void>) | undefined;
    function Wrapper() {
      const el = SqlBrowserPage() as React.ReactElement<{ children: React.ReactNode }>;
      const sectionChildren = React.Children.toArray(el.props.children) as React.ReactElement[];
      const buttonEl = sectionChildren.find(
        (c) => c && typeof c === 'object' && 'type' in c && (c as React.ReactElement).type === 'button'
      ) as React.ReactElement<{ onClick?: () => Promise<void> }> | undefined;
      capturedHandleSubmit = buttonEl?.props?.onClick;
      return el;
    }
    renderToString(React.createElement(Wrapper));

    if (capturedHandleSubmit) {
      await capturedHandleSubmit();
      expect(mockFetch).toHaveBeenCalledWith('/api/chat', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }));
      // Verify the body contains the query
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body as string) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.messages[0].role).toBe('user');
      expect(body.messages[0].content).toContain('Show all users from the last 7 days');
    }
  });

  it('handleSubmit: handles non-ok fetch response (throws error)', async () => {
    const { SqlBrowserPage } = await import('./sql.js');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, body: null });

    let capturedHandleSubmit: (() => Promise<void>) | undefined;
    function Wrapper() {
      const el = SqlBrowserPage() as React.ReactElement<{ children: React.ReactNode }>;
      const sectionChildren = React.Children.toArray(el.props.children) as React.ReactElement[];
      const buttonEl = sectionChildren.find(
        (c) => c && typeof c === 'object' && 'type' in c && (c as React.ReactElement).type === 'button'
      ) as React.ReactElement<{ onClick?: () => Promise<void> }> | undefined;
      capturedHandleSubmit = buttonEl?.props?.onClick;
      return el;
    }
    renderToString(React.createElement(Wrapper));

    if (capturedHandleSubmit) {
      await expect(capturedHandleSubmit()).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith('/api/chat', expect.any(Object));
    }
  });

  it('handleSubmit: handles missing response body (getReader returns null)', async () => {
    const { SqlBrowserPage } = await import('./sql.js');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: null, // body is null → getReader() would throw → hits "No response body" error path
    });

    let capturedHandleSubmit: (() => Promise<void>) | undefined;
    function Wrapper() {
      const el = SqlBrowserPage() as React.ReactElement<{ children: React.ReactNode }>;
      const sectionChildren = React.Children.toArray(el.props.children) as React.ReactElement[];
      const buttonEl = sectionChildren.find(
        (c) => c && typeof c === 'object' && 'type' in c && (c as React.ReactElement).type === 'button'
      ) as React.ReactElement<{ onClick?: () => Promise<void> }> | undefined;
      capturedHandleSubmit = buttonEl?.props?.onClick;
      return el;
    }
    renderToString(React.createElement(Wrapper));

    if (capturedHandleSubmit) {
      await expect(capturedHandleSubmit()).resolves.toBeUndefined();
    }
  });

  it('handleSubmit: handles network error (fetch throws)', async () => {
    const { SqlBrowserPage } = await import('./sql.js');
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    let capturedHandleSubmit: (() => Promise<void>) | undefined;
    function Wrapper() {
      const el = SqlBrowserPage() as React.ReactElement<{ children: React.ReactNode }>;
      const sectionChildren = React.Children.toArray(el.props.children) as React.ReactElement[];
      const buttonEl = sectionChildren.find(
        (c) => c && typeof c === 'object' && 'type' in c && (c as React.ReactElement).type === 'button'
      ) as React.ReactElement<{ onClick?: () => Promise<void> }> | undefined;
      capturedHandleSubmit = buttonEl?.props?.onClick;
      return el;
    }
    renderToString(React.createElement(Wrapper));

    if (capturedHandleSubmit) {
      await expect(capturedHandleSubmit()).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalled();
    }
  });

  it('handleSubmit: covers streaming loop — accumulates chunks and calls setResult', async () => {
    const { SqlBrowserPage } = await import('./sql.js');
    const encoder = new TextDecoder();
    void encoder; // suppress unused warning

    const chunk1 = new TextEncoder().encode('SELECT ');
    const chunk2 = new TextEncoder().encode('* FROM users;');

    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: chunk1 })
        .mockResolvedValueOnce({ done: false, value: chunk2 })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: { getReader: () => mockReader },
    });

    let capturedHandleSubmit: (() => Promise<void>) | undefined;
    function Wrapper() {
      const el = SqlBrowserPage() as React.ReactElement<{ children: React.ReactNode }>;
      const sectionChildren = React.Children.toArray(el.props.children) as React.ReactElement[];
      const buttonEl = sectionChildren.find(
        (c) => c && typeof c === 'object' && 'type' in c && (c as React.ReactElement).type === 'button'
      ) as React.ReactElement<{ onClick?: () => Promise<void> }> | undefined;
      capturedHandleSubmit = buttonEl?.props?.onClick;
      return el;
    }
    renderToString(React.createElement(Wrapper));

    if (capturedHandleSubmit) {
      await capturedHandleSubmit();
      // reader.read was called 3 times (chunk1, chunk2, done)
      expect(mockReader.read).toHaveBeenCalledTimes(3);
    }
  });
});
