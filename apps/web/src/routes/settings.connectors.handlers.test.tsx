/**
 * settings.connectors.handlers.test.tsx
 *
 * Covers handler bodies that cannot be exercised via renderToString alone:
 *   - handleTestConnection finally block: setStatus('idle')  [line 156]
 *   - handleSave body: window.confirm + setTimeout           [lines 161-170]
 *   - onChange on the endpoint input: e => setEndpoint(...)  [line 228]
 *
 * Strategy:
 *   1. Mock useState to expose setter spies and return useful initial state.
 *   2. Call ConnectorsSettingsPage() as a function to get the React element tree.
 *   3. Find the McpConnectorCard element in that tree (section > children[2]).
 *   4. Call its type() as a function to get McpConnectorCard's own VNode tree.
 *   5. Drill into that tree to locate the buttons and input and invoke handlers.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

// ── Setter spies captured per useState call in McpConnectorCard ────────────────
// Call order within McpConnectorCard:
//   call 4: health     → setHealth spy
//   call 5: status     → setStatus spy
//   call 6: endpoint   → setEndpoint spy
//   call 7: toast      → setToast spy

const setHealthSpy = vi.fn();
const setStatusSpy = vi.fn();
const setEndpointSpy = vi.fn();
const setToastSpy = vi.fn();

let _useStateCallCount = 0;

const INITIAL_HEALTH = {
  contractVersion: '1.2.3',
  validationStatus: 'passed' as const,
  diagnostics: '',
  mismatches: [],
  lastValidationTimestamp: '2026-03-01T10:00:00Z',
  apiKeyStatus: 'configured' as const,
  endpointUrl: 'http://localhost:8080/mcp',
};

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    useState: (initial: unknown) => {
      _useStateCallCount++;
      const count = _useStateCallCount;
      // ConnectorsSettingsPage: calls 1-3
      if (count === 1) return [[], vi.fn()];               // connectors
      if (count === 2) return [{}, vi.fn()];               // enabled
      if (count === 3) return ['idle', vi.fn()];           // outer status
      // McpConnectorCard: calls 4-7
      if (count === 4) return [INITIAL_HEALTH, setHealthSpy];
      if (count === 5) return ['idle', setStatusSpy];
      if (count === 6) return ['http://localhost:8080/mcp', setEndpointSpy];
      if (count === 7) return [null, setToastSpy];
      return (original.useState as (v: unknown) => [unknown, unknown])(initial);
    },
    useCallback: <T,>(fn: T): T => fn,
    useEffect: (_cb: unknown) => { /* no-op */ },
  };
});

const mockFetch = vi.fn();

beforeEach(() => {
  _useStateCallCount = 0;
  vi.clearAllMocks();
  globalThis.fetch = mockFetch;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Helper: get McpConnectorCard's VNode tree ──────────────────────────────────

async function getMcpCardVNode() {
  const { ConnectorsSettingsPage } = await import('./settings.connectors.js');

  // Reset call count before rendering so useState assignments are consistent
  _useStateCallCount = 0;

  // ConnectorsSettingsPage returns:
  //   <section>
  //     <h1>...</h1>                   index 0
  //     <p>...</p>                     index 1
  //     {loading && ...}               index 2 (null)
  //     {error && ...}                 index 3 (null)
  //     <McpConnectorCard />           index 4
  //     {connectors.map(...)}          index 5
  //   </section>
  const pageEl = ConnectorsSettingsPage() as React.ReactElement<{ children?: React.ReactNode[] }>;
  const children = React.Children.toArray(pageEl.props.children);

  // Find the McpConnectorCard element — its type is a function named 'McpConnectorCard'
  const mcpEl = children.find(
    (child) =>
      React.isValidElement(child) &&
      typeof child.type === 'function' &&
      (child.type as { name?: string }).name === 'McpConnectorCard'
  ) as React.ReactElement | undefined;

  if (!mcpEl) throw new Error('McpConnectorCard element not found in ConnectorsSettingsPage tree');

  // Reset count again before calling McpConnectorCard so its useState calls start at 1
  _useStateCallCount = 3; // Skip the 3 ConnectorsSettingsPage calls

  // Call McpConnectorCard as a function to get its VNode tree
  const McpFn = mcpEl.type as () => React.ReactElement<{ children?: React.ReactNode }>;
  const cardEl = McpFn() as React.ReactElement<{ children?: React.ReactNode }>;

  return cardEl;
}

/** Recursively find first element with matching prop key */
function _findByProp<T>(
  node: React.ReactNode,
  propKey: string
): React.ReactElement<{ [key: string]: T }> | undefined {
  if (!React.isValidElement(node)) return undefined;
  const el = node as React.ReactElement<{ [key: string]: unknown }>;
  if (propKey in el.props) return el as React.ReactElement<{ [key: string]: T }>;
  const children = el.props.children;
  if (!children) return undefined;
  for (const child of React.Children.toArray(children as React.ReactNode)) {
    const result = _findByProp<T>(child, propKey);
    if (result) return result;
  }
  return undefined;
}

/** Find all elements with a given prop key (shallow children iteration) */
function findAllByProp<T>(
  node: React.ReactNode,
  propKey: string,
  results: Array<React.ReactElement<{ [key: string]: T }>> = []
): Array<React.ReactElement<{ [key: string]: T }>> {
  if (!React.isValidElement(node)) return results;
  const el = node as React.ReactElement<{ [key: string]: unknown }>;
  if (propKey in el.props) results.push(el as React.ReactElement<{ [key: string]: T }>);
  const children = el.props.children;
  if (children) {
    for (const child of React.Children.toArray(children as React.ReactNode)) {
      findAllByProp(child, propKey, results);
    }
  }
  return results;
}

// ── handleTestConnection: finally block → setStatus('idle') ───────────────────

describe('handleTestConnection finally block (line 156)', () => {
  it('calls setStatus("idle") in finally after successful test', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, validationState: { ...INITIAL_HEALTH } }),
    });

    const cardEl = await getMcpCardVNode();

    // Find button with "Test Connection" text — it has an onClick
    const buttons = findAllByProp<() => void>(cardEl, 'onClick');
    const testBtn = buttons.find((btn) => {
      const el = btn as React.ReactElement<{ children?: React.ReactNode }>;
      const text = String(el.props.children ?? '');
      return text.includes('Test Connection') || text.includes('Testing');
    });

    expect(testBtn).toBeDefined();
    if (!testBtn) return;

    const onClick = testBtn.props['onClick'] as (() => Promise<void>) | undefined;
    expect(typeof onClick).toBe('function');

    // Invoke handler
    const promise = onClick?.();
    await promise;

    // The finally block should have set status to 'idle'
    expect(setStatusSpy).toHaveBeenCalledWith('idle');
  });

  it('calls setStatus("idle") in finally after failed test (non-ok)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ success: false, validationState: null }),
    });

    const cardEl = await getMcpCardVNode();
    const buttons = findAllByProp<() => void>(cardEl, 'onClick');
    const testBtn = buttons.find((btn) => {
      const el = btn as React.ReactElement<{ children?: React.ReactNode }>;
      const text = String(el.props.children ?? '');
      return text.includes('Test Connection') || text.includes('Testing');
    });

    if (!testBtn) return;
    const onClick = testBtn.props['onClick'] as (() => Promise<void>) | undefined;
    const promise = onClick?.();
    await promise;

    expect(setStatusSpy).toHaveBeenCalledWith('idle');
  });

  it('calls setStatus("idle") in finally even when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const cardEl = await getMcpCardVNode();
    const buttons = findAllByProp<() => void>(cardEl, 'onClick');
    const testBtn = buttons.find((btn) => {
      const el = btn as React.ReactElement<{ children?: React.ReactNode }>;
      const text = String(el.props.children ?? '');
      return text.includes('Test Connection') || text.includes('Testing');
    });

    if (!testBtn) return;
    const onClick = testBtn.props['onClick'] as (() => Promise<void>) | undefined;
    const promise = onClick?.();
    await promise;

    expect(setStatusSpy).toHaveBeenCalledWith('idle');
  });
});

// ── handleSave: window.confirm + setTimeout ────────────────────────────────────

describe('handleSave body (lines 161-170)', () => {
  it('does NOT call setStatus when window.confirm returns false', async () => {
    // In node environment, set up globalThis.window.confirm
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('window', { confirm: confirmMock });

    const cardEl = await getMcpCardVNode();
    const buttons = findAllByProp<() => void>(cardEl, 'onClick');
    const saveBtn = buttons.find((btn) => {
      const el = btn as React.ReactElement<{ children?: React.ReactNode }>;
      const text = String(el.props.children ?? '');
      return text.includes('Save') && !text.includes('Test');
    });

    expect(saveBtn).toBeDefined();
    if (!saveBtn) return;

    const onClick = saveBtn.props['onClick'] as (() => void) | undefined;
    onClick?.();

    // confirm returned false → should return early, no setStatus('saving')
    expect(setStatusSpy).not.toHaveBeenCalledWith('saving');

    vi.unstubAllGlobals();
  });

  it('calls setStatus("saving") and then setStatus("idle") via setTimeout when confirm returns true', async () => {
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal('window', { confirm: confirmMock });

    const cardEl = await getMcpCardVNode();
    const buttons = findAllByProp<() => void>(cardEl, 'onClick');
    const saveBtn = buttons.find((btn) => {
      const el = btn as React.ReactElement<{ children?: React.ReactNode }>;
      const text = String(el.props.children ?? '');
      return text.includes('Save') && !text.includes('Test');
    });

    if (!saveBtn) return;
    const onClick = saveBtn.props['onClick'] as (() => void) | undefined;
    onClick?.();

    // Should immediately call setStatus('saving')
    expect(setStatusSpy).toHaveBeenCalledWith('saving');

    // After setTimeout resolves, setStatus('idle') and setHealth/showToast should fire
    vi.runAllTimers();
    expect(setStatusSpy).toHaveBeenCalledWith('idle');
    expect(setToastSpy).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('calls setHealth updater inside setTimeout when confirm is true', async () => {
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal('window', { confirm: confirmMock });

    const cardEl = await getMcpCardVNode();
    const buttons = findAllByProp<() => void>(cardEl, 'onClick');
    const saveBtn = buttons.find((btn) => {
      const el = btn as React.ReactElement<{ children?: React.ReactNode }>;
      const text = String(el.props.children ?? '');
      return text.includes('Save') && !text.includes('Test');
    });

    if (!saveBtn) return;
    const onClick = saveBtn.props['onClick'] as (() => void) | undefined;
    onClick?.();
    vi.runAllTimers();

    // setHealth was called with a functional updater — call that updater to verify behavior
    expect(setHealthSpy).toHaveBeenCalled();
    const updater = setHealthSpy.mock.calls[0][0] as (prev: typeof INITIAL_HEALTH | null) => unknown;
    if (typeof updater === 'function') {
      const result = updater(INITIAL_HEALTH);
      expect(result).toMatchObject({ endpointUrl: 'http://localhost:8080/mcp' });
      // Calling with null returns null
      expect(updater(null)).toBeNull();
    }

    vi.unstubAllGlobals();
  });
});

// ── onChange on endpoint input (line 228) ─────────────────────────────────────

describe('endpoint input onChange (line 228)', () => {
  it('calls setEndpoint with e.target.value when input changes', async () => {
    const cardEl = await getMcpCardVNode();

    // Find the text input element (type="text")
    const inputs = findAllByProp<(e: { target: { value: string } }) => void>(cardEl, 'onChange');
    const endpointInput = inputs.find((el) => {
      const props = el.props as { type?: string };
      return props.type === 'text';
    });

    expect(endpointInput).toBeDefined();
    if (!endpointInput) return;

    const onChange = endpointInput.props['onChange'] as (e: { target: { value: string } }) => void;
    onChange({ target: { value: 'http://new-endpoint:9090/mcp' } });

    expect(setEndpointSpy).toHaveBeenCalledWith('http://new-endpoint:9090/mcp');
  });
});
