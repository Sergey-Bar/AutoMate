/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGenerate = vi.fn();
const mockReset = vi.fn();

vi.mock('../../hooks/useAIGenerate.js', () => ({
  useAIGenerate: vi.fn(),
}));

import { useAIGenerate } from '../../hooks/useAIGenerate.js';
import { NLTestGenerator } from './NLTestGenerator.js';

const mockUseAIGenerate = useAIGenerate as ReturnType<typeof vi.fn>;

function defaultHookState(overrides: Record<string, unknown> = {}) {
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
    render(<NLTestGenerator />);
    expect(screen.getByTestId('nl-prompt')).toBeInTheDocument();
  });

  it('renders the Generate button', () => {
    render(<NLTestGenerator />);
    expect(screen.getByTestId('generate-btn')).toBeInTheDocument();
    expect(screen.getByTestId('generate-btn')).toHaveTextContent('Generate');
  });

  it('renders the target URL input', () => {
    render(<NLTestGenerator />);
    expect(screen.getByTestId('target-url')).toBeInTheDocument();
  });

  it('renders the Generated Test panel heading', () => {
    render(<NLTestGenerator />);
    expect(screen.getByText('Generated Test')).toBeInTheDocument();
  });

  it('shows empty state placeholder when no result', () => {
    render(<NLTestGenerator />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });

  it('shows loading state when status is loading', () => {
    mockUseAIGenerate.mockReturnValue(defaultHookState({ status: 'loading' }));
    render(<NLTestGenerator />);
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
  });

  it('renders code block when result is available', () => {
    mockUseAIGenerate.mockReturnValue(
      defaultHookState({
        status: 'success',
        result: { code: 'test("login", async () => {})', explanation: 'Tests login flow' },
      })
    );
    render(<NLTestGenerator />);
    expect(screen.getByTestId('code-block')).toBeInTheDocument();
    expect(screen.getByTestId('code-block')).toHaveTextContent('test("login"');
  });

  it('renders explanation when result is available', () => {
    mockUseAIGenerate.mockReturnValue(
      defaultHookState({
        status: 'success',
        result: { code: 'code', explanation: 'Tests login flow' },
      })
    );
    render(<NLTestGenerator />);
    expect(screen.getByTestId('explanation')).toHaveTextContent('Tests login flow');
  });

  it('renders copy and run test buttons when result is available', () => {
    mockUseAIGenerate.mockReturnValue(
      defaultHookState({
        status: 'success',
        result: { code: 'code', explanation: 'exp' },
      })
    );
    render(<NLTestGenerator />);
    expect(screen.getByTestId('copy-btn')).toBeInTheDocument();
    expect(screen.getByTestId('run-test-btn')).toBeInTheDocument();
  });

  it('renders error message when status is error', () => {
    mockUseAIGenerate.mockReturnValue(
      defaultHookState({ status: 'error', error: 'HTTP 500' })
    );
    render(<NLTestGenerator />);
    expect(screen.getByTestId('error-msg')).toHaveTextContent('Error: HTTP 500');
  });

  it('renders reset button when result is present', () => {
    mockUseAIGenerate.mockReturnValue(
      defaultHookState({
        status: 'success',
        result: { code: 'code', explanation: 'exp' },
      })
    );
    render(<NLTestGenerator />);
    expect(screen.getByTestId('reset-btn')).toBeInTheDocument();
  });

  it('calls generate when Generate button is clicked', async () => {
    render(<NLTestGenerator />);
    const textarea = screen.getByTestId('nl-prompt');
    fireEvent.change(textarea, { target: { value: 'test login flow' } });
    const btn = screen.getByTestId('generate-btn');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(mockGenerate).toHaveBeenCalledWith('test login flow', '');
    });
  });

  it('shows Run Test alert when run test button clicked', () => {
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    mockUseAIGenerate.mockReturnValue(
      defaultHookState({
        status: 'success',
        result: { code: 'code', explanation: 'exp' },
      })
    );
    render(<NLTestGenerator />);
    fireEvent.click(screen.getByTestId('run-test-btn'));
    expect(alertMock).toHaveBeenCalledWith('Run Test: feature coming soon!');
    alertMock.mockRestore();
  });

  it('generate button is disabled when prompt is empty', () => {
    render(<NLTestGenerator />);
    expect(screen.getByTestId('generate-btn')).toBeDisabled();
  });

  it('generate button is enabled once prompt has content', () => {
    render(<NLTestGenerator />);
    fireEvent.change(screen.getByTestId('nl-prompt'), { target: { value: 'test something' } });
    expect(screen.getByTestId('generate-btn')).not.toBeDisabled();
  });

  it('does not call generate when prompt is empty via Ctrl+Enter', () => {
    render(<NLTestGenerator />);
    const textarea = screen.getByTestId('nl-prompt');
    // prompt is still empty
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('Ctrl+Enter on textarea triggers generate when prompt is filled', async () => {
    render(<NLTestGenerator />);
    const textarea = screen.getByTestId('nl-prompt');
    fireEvent.change(textarea, { target: { value: 'click the login button' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(mockGenerate).toHaveBeenCalledWith('click the login button', '');
    });
  });

  it('passes targetUrl to generate', async () => {
    render(<NLTestGenerator />);
    fireEvent.change(screen.getByTestId('nl-prompt'), { target: { value: 'test' } });
    fireEvent.change(screen.getByTestId('target-url'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByTestId('generate-btn'));
    await waitFor(() => {
      expect(mockGenerate).toHaveBeenCalledWith('test', 'https://example.com');
    });
  });

  it('reset button click calls reset()', () => {
    mockUseAIGenerate.mockReturnValue(
      defaultHookState({
        status: 'success',
        result: { code: 'code', explanation: 'exp' },
      })
    );
    render(<NLTestGenerator />);
    fireEvent.click(screen.getByTestId('reset-btn'));
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it('reset button is shown when error is set (result is null)', () => {
    mockUseAIGenerate.mockReturnValue(
      defaultHookState({ status: 'error', error: 'fail', result: null })
    );
    render(<NLTestGenerator />);
    expect(screen.getByTestId('reset-btn')).toBeInTheDocument();
  });

  it('result without explanation shows no explanation panel', () => {
    mockUseAIGenerate.mockReturnValue(
      defaultHookState({
        status: 'success',
        result: { code: 'some code', explanation: '' },
      })
    );
    render(<NLTestGenerator />);
    expect(screen.getByTestId('code-block')).toBeInTheDocument();
    expect(screen.queryByTestId('explanation')).toBeNull();
  });

  it('copy button calls clipboard.writeText with the generated code', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    mockUseAIGenerate.mockReturnValue(
      defaultHookState({
        status: 'success',
        result: { code: 'test("login", () => {})', explanation: 'exp' },
      })
    );
    render(<NLTestGenerator />);
    fireEvent.click(screen.getByTestId('copy-btn'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('test("login", () => {})');
    });
  });

  it('copy button shows "Copied!" immediately after click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    mockUseAIGenerate.mockReturnValue(
      defaultHookState({
        status: 'success',
        result: { code: 'code', explanation: 'exp' },
      })
    );
    render(<NLTestGenerator />);
    fireEvent.click(screen.getByTestId('copy-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('copy-btn')).toHaveTextContent('Copied!');
    });
  });
});
