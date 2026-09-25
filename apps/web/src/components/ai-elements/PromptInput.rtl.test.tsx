/**
 * PromptInput.rtl.test.tsx
 *
 * RTL tests for the PromptInput component exported from ai-elements/index.tsx.
 * Targets the onChange resize logic (lines 120-121) which requires actual DOM
 * scrollHeight to be exercised, and the handleKeyDown Enter branch.
 */
import { render, screen, fireEvent, act } from '../../test/test-utils.js';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      React.createElement('div', { className }, children),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/motion.js', () => ({
  reducedMotionSafe: vi.fn((v: unknown) => v),
  fadeSlideUp: { hidden: {}, visible: {} },
  messageBubble: { hidden: {}, visible: {} },
  spring: { snappy: {}, smooth: {} },
  prefersReducedMotion: vi.fn(() => false),
}));

vi.mock('lucide-react', () => ({
  Send: () => null,
}));

import React from 'react';
import { PromptInput } from './index.js';

describe('PromptInput RTL — onChange resize coverage', () => {
  it('renders textarea with placeholder', () => {
    const onSubmit = vi.fn();
    render(<PromptInput placeholder="Type here..." onSubmit={onSubmit} />);

    const textarea = screen.getByTestId('prompt-input');
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveAttribute('placeholder', 'Type here...');
  });

  it('onChange updates value and triggers resize logic (lines 119-121)', async () => {
    const onSubmit = vi.fn();
    render(<PromptInput onSubmit={onSubmit} />);

    const textarea = screen.getByTestId('prompt-input');

    // Simulate typing - triggers the onChange handler including resize logic
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Hello world' } });
    });

    expect(textarea).toHaveValue('Hello world');
  });

  it('textarea resize is triggered on multiple changes (covers lines 120-121 repeatedly)', async () => {
    const onSubmit = vi.fn();
    render(<PromptInput onSubmit={onSubmit} />);

    const textarea = screen.getByTestId('prompt-input');

    // Simulate multiple typing events
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Line 1' } });
    });
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Line 1\nLine 2\nLine 3' } });
    });

    expect(textarea).toHaveValue('Line 1\nLine 2\nLine 3');
  });

  it('Enter key (no shift) submits the form and clears input', async () => {
    const onSubmit = vi.fn();
    render(<PromptInput onSubmit={onSubmit} />);

    const textarea = screen.getByTestId('prompt-input');

    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'My message' } });
    });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    expect(onSubmit).toHaveBeenCalledWith('My message');
    expect(textarea).toHaveValue('');
  });

  it('Shift+Enter does NOT submit (allows newline)', async () => {
    const onSubmit = vi.fn();
    render(<PromptInput onSubmit={onSubmit} />);

    const textarea = screen.getByTestId('prompt-input');

    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'My message' } });
    });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Send button click submits the form', async () => {
    const onSubmit = vi.fn();
    render(<PromptInput onSubmit={onSubmit} />);

    const textarea = screen.getByTestId('prompt-input');

    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Click to send' } });
    });

    const sendBtn = screen.getByRole('button', { name: /send/i });
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    expect(onSubmit).toHaveBeenCalledWith('Click to send');
  });

  it('Send button is disabled when textarea is empty', () => {
    const onSubmit = vi.fn();
    render(<PromptInput onSubmit={onSubmit} />);

    const sendBtn = screen.getByRole('button', { name: /send/i });
    expect(sendBtn).toBeDisabled();
  });

  it('disabled prop disables both textarea and send button', () => {
    const onSubmit = vi.fn();
    render(<PromptInput onSubmit={onSubmit} disabled />);

    const textarea = screen.getByTestId('prompt-input');
    const sendBtn = screen.getByRole('button', { name: /send/i });

    expect(textarea).toBeDisabled();
    expect(sendBtn).toBeDisabled();
  });

  it('onSubmit not called when only whitespace is entered', async () => {
    const onSubmit = vi.fn();
    render(<PromptInput onSubmit={onSubmit} />);

    const textarea = screen.getByTestId('prompt-input');

    await act(async () => {
      fireEvent.change(textarea, { target: { value: '   ' } });
    });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
