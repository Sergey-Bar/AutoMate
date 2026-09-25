/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../automate.js', () => ({
  Route: { id: 'automate' },
}));

import { CodegenPanel } from '../../components/automate/CodegenPanel.js';
import { RecorderBridge } from '../../components/automate/RecorderBridge.js';
import { CodegenPage, Route as CodegenRoute } from './codegen.js';

// Mock clipboard API
const writeTextMock = vi.fn(() => Promise.resolve());
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: writeTextMock },
  writable: true,
});

describe('CodegenPanel', () => {
  it('renders code content', () => {
    render(<CodegenPanel code="const x = 1;" language="typescript" />);
    expect(screen.getByTestId('code-block')).toHaveTextContent('const x = 1;');
  });

  it('renders language badge', () => {
    render(<CodegenPanel code="print('hello')" language="python" />);
    expect(screen.getByTestId('language-badge')).toHaveTextContent('python');
  });

  it('copy button copies code to clipboard', async () => {
    render(<CodegenPanel code="const x = 1;" language="typescript" />);
    const copyBtn = screen.getByTestId('copy-button');
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('const x = 1;');
    });
  });

  it('copy button shows Copied! after click', async () => {
    render(<CodegenPanel code="test code" language="typescript" />);
    const copyBtn = screen.getByTestId('copy-button');
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(screen.getByTestId('copy-button')).toHaveTextContent('Copied!');
    });
  });
});

describe('RecorderBridge', () => {
  it('renders idle status badge', () => {
    render(
      <RecorderBridge
        status="idle"
        onStart={vi.fn()}
        onStop={vi.fn()}
        onPause={vi.fn()}
      />
    );
    expect(screen.getByTestId('recorder-status')).toHaveTextContent('Idle');
  });

  it('renders recording status badge', () => {
    render(
      <RecorderBridge
        status="recording"
        onStart={vi.fn()}
        onStop={vi.fn()}
        onPause={vi.fn()}
      />
    );
    expect(screen.getByTestId('recorder-status')).toHaveTextContent('Recording');
  });

  it('renders paused status badge', () => {
    render(
      <RecorderBridge
        status="paused"
        onStart={vi.fn()}
        onStop={vi.fn()}
        onPause={vi.fn()}
      />
    );
    expect(screen.getByTestId('recorder-status')).toHaveTextContent('Paused');
  });

  it('calls onStart with URL when start button clicked', () => {
    const onStart = vi.fn();
    render(
      <RecorderBridge
        status="idle"
        onStart={onStart}
        onStop={vi.fn()}
        onPause={vi.fn()}
      />
    );
    const urlInput = screen.getByTestId('url-input');
    fireEvent.change(urlInput, { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByTestId('start-button'));
    expect(onStart).toHaveBeenCalledWith('https://example.com');
  });

  it('calls onStop when stop button clicked', () => {
    const onStop = vi.fn();
    render(
      <RecorderBridge
        status="recording"
        onStart={vi.fn()}
        onStop={onStop}
        onPause={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('stop-button'));
    expect(onStop).toHaveBeenCalled();
  });

  it('calls onPause when pause button clicked during recording', () => {
    const onPause = vi.fn();
    render(
      <RecorderBridge
        status="recording"
        onStart={vi.fn()}
        onStop={vi.fn()}
        onPause={onPause}
      />
    );
    fireEvent.click(screen.getByTestId('pause-button'));
    expect(onPause).toHaveBeenCalled();
  });

  it('disables start button when recording', () => {
    render(
      <RecorderBridge
        status="recording"
        onStart={vi.fn()}
        onStop={vi.fn()}
        onPause={vi.fn()}
      />
    );
    expect(screen.getByTestId('start-button')).toBeDisabled();
  });

  it('disables stop button when idle', () => {
    render(
      <RecorderBridge
        status="idle"
        onStart={vi.fn()}
        onStop={vi.fn()}
        onPause={vi.fn()}
      />
    );
    expect(screen.getByTestId('stop-button')).toBeDisabled();
  });
});

// ─── CodegenPage ──────────────────────────────────────────────────────────────


describe('CodegenPage', () => {
  it('renders page container with heading', () => {
    render(<CodegenPage />);
    expect(screen.getByTestId('codegen-page')).toBeInTheDocument();
    expect(screen.getByText('Codegen')).toBeInTheDocument();
    expect(screen.getByText(/Record browser interactions/)).toBeInTheDocument();
  });

  it('renders RecorderBridge in idle state initially', () => {
    render(<CodegenPage />);
    expect(screen.getByTestId('recorder-status')).toHaveTextContent('Idle');
  });

  it('renders CodegenPanel with typescript language badge initially', () => {
    render(<CodegenPage />);
    expect(screen.getByTestId('language-badge')).toHaveTextContent('typescript');
  });

  it('shows placeholder code before recording', () => {
    render(<CodegenPage />);
    expect(screen.getByTestId('code-block')).toHaveTextContent("test('recorded test'");
  });

  it('switches to recording status and updates code when start is clicked with URL', () => {
    render(<CodegenPage />);
    fireEvent.change(screen.getByTestId('url-input'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.click(screen.getByTestId('start-button'));
    expect(screen.getByTestId('recorder-status')).toHaveTextContent('Recording');
    expect(screen.getByTestId('code-block')).toHaveTextContent('https://example.com');
  });

  it('switches back to idle when stop is clicked after recording', () => {
    render(<CodegenPage />);
    fireEvent.change(screen.getByTestId('url-input'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.click(screen.getByTestId('start-button'));
    expect(screen.getByTestId('recorder-status')).toHaveTextContent('Recording');

    fireEvent.click(screen.getByTestId('stop-button'));
    expect(screen.getByTestId('recorder-status')).toHaveTextContent('Idle');
  });

  it('switches to paused status when pause is clicked during recording', () => {
    render(<CodegenPage />);
    fireEvent.change(screen.getByTestId('url-input'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.click(screen.getByTestId('start-button'));
    fireEvent.click(screen.getByTestId('pause-button'));
    expect(screen.getByTestId('recorder-status')).toHaveTextContent('Paused');
  });

  it('generates code containing page.goto with the supplied URL', () => {
    render(<CodegenPage />);
    fireEvent.change(screen.getByTestId('url-input'), {
      target: { value: 'https://myapp.test' },
    });
    fireEvent.click(screen.getByTestId('start-button'));
    expect(screen.getByTestId('code-block')).toHaveTextContent('myapp.test');
  });

  it('copy button works on generated code after recording starts', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
    });
    render(<CodegenPage />);
    fireEvent.change(screen.getByTestId('url-input'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.click(screen.getByTestId('start-button'));
    fireEvent.click(screen.getByTestId('copy-button'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
  });

  it('Route.options.getParentRoute returns defined parent', () => {
    const opts = (CodegenRoute as unknown as { options: { getParentRoute: () => unknown } }).options;
    expect(opts.getParentRoute()).toBeDefined();
  });

  it('Route.options.component lambda renders CodegenPage', () => {
    const opts = (CodegenRoute as unknown as { options: { component: () => React.JSX.Element } }).options;
    render(opts.component());
    expect(screen.getByTestId('codegen-page')).toBeInTheDocument();
  });
});
