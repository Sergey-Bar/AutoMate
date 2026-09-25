import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { NLTestGenerator } from '../components/automate/NLTestGenerator.js';

const mockGenerate = vi.fn();
const mockReset = vi.fn();

const mockUseAIGenerate = vi.fn();

vi.mock('../hooks/useAIGenerate.js', () => ({
  useAIGenerate: mockUseAIGenerate,
}));

function defaultHookState(overrides = {}) {
  return {
    status: 'idle',
    result: null,
    error: null,
    generate: mockGenerate,
    reset: mockReset,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockUseAIGenerate.mockReturnValue(defaultHookState());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NLTestGenerator', () => {
  it('renders the NL prompt textarea', () => {
    const html = renderToString(<NLTestGenerator />);
    expect(html).toContain('id="nl-prompt"');
    expect(html).toContain('<textarea');
  });

  it('renders the Generate button', () => {
    const html = renderToString(<NLTestGenerator />);
    expect(html).toContain('id="generate-btn"');
    expect(html).toContain('Generate');
  });

  it('renders the target URL input', () => {
    const html = renderToString(<NLTestGenerator />);
    expect(html).toContain('id="target-url"');
  });

  it('renders placeholder text for prompt', () => {
    const html = renderToString(<NLTestGenerator />);
    expect(html).toContain('Navigate to the login page');
  });

  it('renders the Generated Test panel heading', () => {
    const html = renderToString(<NLTestGenerator />);
    expect(html).toContain('Generated Test');
  });

  it('shows placeholder text when no result', () => {
    const html = renderToString(<NLTestGenerator />);
    expect(html).toContain('Generated Playwright test code will appear here');
  });

  it('shows loading text when status is loading', () => {
    mockUseAIGenerate.mockReturnValue(defaultHookState({ status: 'loading' }));
    const html = renderToString(<NLTestGenerator />);
    expect(html).toContain('Generating test');
  });

  it('renders code block when result is available', () => {
    mockUseAIGenerate.mockReturnValue(
      defaultHookState({
        status: 'success',
        result: { code: 'test("login", async () => {})', explanation: 'Tests login flow' },
      })
    );
    const html = renderToString(<NLTestGenerator />);
    expect(html).toContain('<pre');
    expect(html).toContain('<code>');
    expect(html).toContain('test(&quot;login&quot;');
  });

  it('renders explanation when result is available', () => {
    mockUseAIGenerate.mockReturnValue(
      defaultHookState({
        status: 'success',
        result: { code: 'code', explanation: 'Tests login flow' },
      })
    );
    const html = renderToString(<NLTestGenerator />);
    expect(html).toContain('Tests login flow');
    expect(html).toContain('Explanation');
  });

  it('renders copy and run test buttons when result is available', () => {
    mockUseAIGenerate.mockReturnValue(
      defaultHookState({
        status: 'success',
        result: { code: 'code', explanation: 'exp' },
      })
    );
    const html = renderToString(<NLTestGenerator />);
    expect(html).toContain('id="copy-btn"');
    expect(html).toContain('id="run-test-btn"');
    expect(html).toContain('Run Test');
  });

  it('renders error message when status is error', () => {
    mockUseAIGenerate.mockReturnValue(
      defaultHookState({ status: 'error', error: 'HTTP 500' })
    );
    const html = renderToString(<NLTestGenerator />);
    expect(html).toContain('Error: HTTP 500');
  });

  it('renders reset button when result is present', () => {
    mockUseAIGenerate.mockReturnValue(
      defaultHookState({
        status: 'success',
        result: { code: 'code', explanation: 'exp' },
      })
    );
    const html = renderToString(<NLTestGenerator />);
    expect(html).toContain('Reset');
  });

  it('exports default export', async () => {
    const module = await import('../components/automate/NLTestGenerator.js');
    expect(module.default).toBeDefined();
  });
});
