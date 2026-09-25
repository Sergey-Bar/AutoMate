import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

// ── State injection scaffold ──────────────────────────────────────────────────
// AiTestGenerator calls useState 6 times (in order):
//   1. sourceCode (string)
//   2. filePath   (string)
//   3. result     (GeneratedTest | null)
//   4. error      (string | null)
//   5. loading    (boolean)
//   6. copied     (boolean)
//
// We inject state via a module-level mock so the component's destructured
// `useState` import is intercepted (vi.spyOn on the exported binding
// doesn't work after destructuring at import time).

let _stateSeeds: unknown[] = [];
let _stateSetters: Array<ReturnType<typeof vi.fn>> = [];
let _useStateCallCount = 0;

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    useState: (initial: unknown) => {
      const idx = _useStateCallCount++;
      const setter = _stateSetters[idx] ?? vi.fn();
      const value = idx < _stateSeeds.length ? _stateSeeds[idx] : initial;
      return [value, setter];
    },
  };
});

import { AiTestGenerator } from './AiTestGenerator.js';

// ── Helpers ────────────────────────────────────────────────────────────────────
function resetState(seeds: unknown[], setterCount = 6) {
  _useStateCallCount = 0;
  _stateSeeds = seeds;
  _stateSetters = Array.from({ length: setterCount }, () => vi.fn());
}

const defaultSeeds = ['', '', null, null, false, false];

const getSetResult = () => _stateSetters[2];
const getSetError = () => _stateSetters[3];
const getSetLoading = () => _stateSetters[4];

// Walk a React element tree and find the first button's onClick prop.
// React elements produced by JSX are plain objects: { type, props: { children, onClick, ... } }
function findButtonOnClick(el: unknown): (() => void) | undefined {
  if (!el || typeof el !== 'object') return undefined;
  const node = el as { type?: unknown; props?: Record<string, unknown> };
  if (node.type === 'button' && node.props && typeof node.props['onClick'] === 'function') {
    return node.props['onClick'] as () => void;
  }
  const props = node.props;
  if (!props) return undefined;
  // Check children (may be array, single element, or primitive)
  const children = props['children'];
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findButtonOnClick(child);
      if (found) return found;
    }
  } else if (children && typeof children === 'object') {
    return findButtonOnClick(children);
  }
  return undefined;
}

/** Find ALL button onClick handlers in the element tree (breadth-friendly depth-first). */
function findAllButtonOnClicks(el: unknown): Array<() => void | Promise<void>> {
  const results: Array<() => void | Promise<void>> = [];
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: unknown; props?: Record<string, unknown> };
    if (n.type === 'button' && n.props && typeof n.props['onClick'] === 'function') {
      results.push(n.props['onClick'] as () => void);
    }
    const children = n.props?.['children'];
    if (Array.isArray(children)) {
      for (const child of children) traverse(child);
    } else if (children && typeof children === 'object') {
      traverse(children);
    }
  }
  traverse(el);
  return results;
}

// Render the component with current seeds and capture the generate button's onClick
function captureHandleGenerate(): (() => void) | undefined {
  const el = (AiTestGenerator as () => React.ReactElement)();
  return findButtonOnClick(el);
}

// ── Static rendering tests ─────────────────────────────────────────────────────
describe('AiTestGenerator — static rendering', () => {
  beforeEach(() => {
    resetState(defaultSeeds);
  });

  it('renders heading, file path input, source code textarea, and generate button', () => {
    const html = renderToString(React.createElement(AiTestGenerator));
    expect(html).toContain('AI Test Generator');
    expect(html).toContain('id="file-path"');
    expect(html).toContain('id="source-code"');
    expect(html).toContain('Generate Tests');
  });

  it('renders file path label with htmlFor="file-path"', () => {
    const html = renderToString(React.createElement(AiTestGenerator));
    expect(html).toContain('for="file-path"');
    expect(html).toContain('File Path');
  });

  it('renders source code label with htmlFor="source-code"', () => {
    const html = renderToString(React.createElement(AiTestGenerator));
    expect(html).toContain('for="source-code"');
    expect(html).toContain('Source Code');
  });

  it('renders Generate Tests button with type="button"', () => {
    const html = renderToString(React.createElement(AiTestGenerator));
    expect(html).toContain('type="button"');
    expect(html).toContain('Generate Tests');
  });

  it('renders button as disabled when inputs are empty', () => {
    const html = renderToString(React.createElement(AiTestGenerator));
    expect(html).toContain('disabled');
  });

  it('does not render error alert in initial state', () => {
    const html = renderToString(React.createElement(AiTestGenerator));
    expect(html).not.toContain('role="alert"');
  });

  it('does not render test result section in initial state', () => {
    const html = renderToString(React.createElement(AiTestGenerator));
    expect(html).not.toContain('Copy to Clipboard');
  });

  it('renders placeholder text for file path input', () => {
    const html = renderToString(React.createElement(AiTestGenerator));
    expect(html).toContain('src/services/my-service.ts');
  });

  it('renders placeholder text for source code textarea', () => {
    const html = renderToString(React.createElement(AiTestGenerator));
    expect(html).toContain('Paste your TypeScript source code here');
  });
});

// ── Conditional rendering with seeded state ────────────────────────────────────
describe('AiTestGenerator — conditional rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders test code and Copy to Clipboard button when result is set', () => {
    const mockResult = {
      testCode: 'it("should pass", () => {})',
      testFileName: 'foo.test.ts',
      functionsAnalyzed: ['foo'],
      prompt: 'test',
    };
    resetState(['export function foo() {}', 'foo.ts', mockResult, null, false, false]);

    const html = renderToString(React.createElement(AiTestGenerator));

    expect(html).toContain('Copy to Clipboard');
    expect(html).toContain('foo.test.ts');
    // React SSR renders interpolated numbers with comment markers
    expect(html).toContain('functions analyzed');
  });

  it('renders error alert when error is set', () => {
    resetState(['', '', null, 'LLM unavailable', false, false]);

    const html = renderToString(React.createElement(AiTestGenerator));

    expect(html).toContain('role="alert"');
    expect(html).toContain('LLM unavailable');
  });

  it('renders Generating... text when loading is true', () => {
    resetState(['some code', 'foo.ts', null, null, true, false]);

    const html = renderToString(React.createElement(AiTestGenerator));

    expect(html).toContain('Generating...');
  });

  it('renders Copied! text when copied is true', () => {
    const mockResult = {
      testCode: 'it("should pass", () => {})',
      testFileName: 'foo.test.ts',
      functionsAnalyzed: ['foo'],
      prompt: 'test',
    };
    resetState(['some code', 'foo.ts', mockResult, null, false, true]);

    const html = renderToString(React.createElement(AiTestGenerator));

    expect(html).toContain('Copied!');
  });
});

// ── handleGenerate behavior ────────────────────────────────────────────────────
describe('AiTestGenerator — handleGenerate', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls fetch with correct URL and payload when button is clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        testCode: 'it("should pass", () => {})',
        testFileName: 'foo.test.ts',
        functionsAnalyzed: ['foo'],
        prompt: 'test',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    resetState(['export function foo() {}', 'foo.ts', null, null, false, false]);

    const onClick = captureHandleGenerate();

    expect(onClick).toBeDefined();
    if (onClick) await onClick();

    expect(fetchMock).toHaveBeenCalledWith('/api/ai/generate-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceCode: 'export function foo() {}', filePath: 'foo.ts' }),
    });
  });

  it('calls setResult on successful fetch', async () => {
    const expectedResult = {
      testCode: 'it("works", () => {})',
      testFileName: 'bar.test.ts',
      functionsAnalyzed: ['bar'],
      prompt: 'prompt',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => expectedResult,
    }));
    resetState(['export function bar() {}', 'bar.ts', null, null, false, false]);
    const mockSetResult = getSetResult();
    const mockSetLoading = getSetLoading();

    const onClick = captureHandleGenerate();
    if (onClick) await onClick();

    expect(mockSetLoading).toHaveBeenCalledWith(true);
    expect(mockSetResult).toHaveBeenCalledWith(expectedResult);
  });

  it('calls setError when fetch returns non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'LLM unavailable' }),
    }));
    resetState(['export function foo() {}', 'foo.ts', null, null, false, false]);
    const mockSetError = getSetError();

    const onClick = captureHandleGenerate();
    if (onClick) await onClick();

    expect(mockSetError).toHaveBeenCalledWith('LLM unavailable');
  });

  it('calls setError with fallback message when error response has no error field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    resetState(['export function foo() {}', 'foo.ts', null, null, false, false]);
    const mockSetError = getSetError();

    const onClick = captureHandleGenerate();
    if (onClick) await onClick();

    expect(mockSetError).toHaveBeenCalledWith('Request failed: 503');
  });

  it('calls setError when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    resetState(['export function foo() {}', 'foo.ts', null, null, false, false]);
    const mockSetError = getSetError();

    const onClick = captureHandleGenerate();
    if (onClick) await onClick();

    expect(mockSetError).toHaveBeenCalledWith('Network error');
  });
});

// ── handleCopy coverage (lines 44-47) ─────────────────────────────────────────
describe('AiTestGenerator — handleCopy', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls navigator.clipboard.writeText with testCode when Copy button is clicked', async () => {
    const mockResult = {
      testCode: 'it("should pass", () => {})',
      testFileName: 'foo.test.ts',
      functionsAnalyzed: ['foo'],
      prompt: 'test',
    };
    resetState(['some-code', 'foo.ts', mockResult, null, false, false]);

    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: clipboardWriteText } });

    // With result set, the element tree contains two buttons:
    // [0] = Generate Tests (handleGenerate), [1] = Copy to Clipboard (handleCopy)
    const el = (AiTestGenerator as () => React.ReactElement)();
    const allClicks = findAllButtonOnClicks(el);

    // The copy button is the second button in the tree
    expect(allClicks.length).toBeGreaterThanOrEqual(2);
    if (allClicks[1]) await allClicks[1]();

    expect(clipboardWriteText).toHaveBeenCalledWith('it("should pass", () => {})');
  });

  it('sets copied state via setCopied(true) on successful copy', async () => {
    const mockResult = {
      testCode: 'describe("suite", () => {})',
      testFileName: 'bar.test.ts',
      functionsAnalyzed: ['bar'],
      prompt: 'bar',
    };
    resetState(['bar code', 'bar.ts', mockResult, null, false, false]);
    const setCopiedSetter = _stateSetters[5]; // copied is 6th state (index 5)

    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

    const el = (AiTestGenerator as () => React.ReactElement)();
    const allClicks = findAllButtonOnClicks(el);
    if (allClicks[1]) await allClicks[1]();

    expect(setCopiedSetter).toHaveBeenCalledWith(true);
  });
});
