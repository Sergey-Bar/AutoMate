/**
 * chat-shell.rtl.test.tsx
 *
 * RTL-based tests for ChatShell/ChatContent. Focuses on interaction paths that
 * are hard to reach via renderToString:
 *  - handleApprove fires addToolApprovalResponse({ id, approved: true })   (line 56, 76)
 *  - handleDeny fires addToolApprovalResponse({ id, approved: false })      (line 60, 77)
 *  - handleRetry fires regenerate()                                          (line 52)
 *  - handleSubmit fires sendMessage({ text })                               (line 48)
 */
import { render, screen, fireEvent, waitFor } from '../../test/test-utils.js';
import { act } from '@testing-library/react';

const mockSendMessage = vi.fn();
const mockRegenerate = vi.fn();
const mockAddToolApprovalResponse = vi.fn();

vi.mock('@/hooks/use-automate-chat.js', () => ({
  useAutomateChat: vi.fn(() => ({
    messages: [],
    sendMessage: mockSendMessage,
    isLoading: false,
    error: undefined,
    regenerate: mockRegenerate,
    addToolApprovalResponse: mockAddToolApprovalResponse,
  })),
}));

type MotionMockProps = Record<string, unknown> & {
  children?: React.ReactNode;
  variants?: unknown;
  initial?: unknown;
  animate?: unknown;
  transition?: unknown;
};

const motionElement = (tag: string) => ({ children, variants: _variants, initial: _initial, animate: _animate, transition: _transition, ...props }: MotionMockProps) =>
  React.createElement(tag, props, children);

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_target, prop: string) => motionElement(prop),
  }),
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
  RefreshCw: () => null,
  MessageSquare: () => null,
  Moon: () => null,
  Sun: () => null,
  Monitor: () => null,
  Bug: () => null,
  AlertTriangle: () => null,
  WifiOff: () => null,
}));

import React from 'react';
import { useAutomateChat } from '@/hooks/use-automate-chat.js';
import { ChatShell } from './chat-shell.js';

describe('ChatShell RTL — approve/deny/retry interactions', () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
    mockRegenerate.mockReset();
    mockAddToolApprovalResponse.mockReset();
  });

  it('renders QA workflow starter prompts on an empty conversation', () => {
    vi.mocked(useAutomateChat).mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      isLoading: false,
      error: undefined,
      regenerate: mockRegenerate,
      addToolApprovalResponse: mockAddToolApprovalResponse,
    });

    render(<ChatShell />);

    expect(screen.getByRole('group', { name: 'Starter prompts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Triage failing run/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create regression plan/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check integration health/i })).toBeInTheDocument();
  });

  it('Starter prompt click calls sendMessage with the selected QA prompt', async () => {
    vi.mocked(useAutomateChat).mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      isLoading: false,
      error: undefined,
      regenerate: mockRegenerate,
      addToolApprovalResponse: mockAddToolApprovalResponse,
    });

    render(<ChatShell />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create regression plan/i }));
    });

    expect(mockSendMessage).toHaveBeenCalledWith({
      text: 'Create a focused regression plan for the riskiest user journeys before release.',
    });
  });

  it('disables starter prompts while chat cannot accept input', () => {
    vi.mocked(useAutomateChat).mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      isLoading: true,
      error: undefined,
      regenerate: mockRegenerate,
      addToolApprovalResponse: mockAddToolApprovalResponse,
    });

    render(<ChatShell />);

    expect(screen.getByRole('button', { name: /Triage failing run/i })).toBeDisabled();
  });

  it('Retry button click calls regenerate() — covers line 52', async () => {
    vi.mocked(useAutomateChat).mockReturnValue({
      messages: [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      ] as ReturnType<typeof useAutomateChat>['messages'],
      sendMessage: mockSendMessage,
      isLoading: false,
      error: new Error('oops'),
      regenerate: mockRegenerate,
      addToolApprovalResponse: mockAddToolApprovalResponse,
    });

    render(<ChatShell />);

    const retryBtn = await screen.findByRole('button', { name: /retry last message/i });
    expect(retryBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(retryBtn);
    });

    expect(mockRegenerate).toHaveBeenCalledTimes(1);
  });

  it('Approve button click calls addToolApprovalResponse with approved=true — covers lines 56, 76', async () => {
    vi.mocked(useAutomateChat).mockReturnValue({
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-github.create_issue',
              state: 'approval-requested',
              toolCallId: 'tc1',
              input: { title: 'Bug' },
              approval: { id: 'approval-abc' },
            },
          ],
        },
      ] as ReturnType<typeof useAutomateChat>['messages'],
      sendMessage: mockSendMessage,
      isLoading: false,
      error: undefined,
      regenerate: mockRegenerate,
      addToolApprovalResponse: mockAddToolApprovalResponse,
    });

    render(<ChatShell />);

    const approveBtn = await screen.findByRole('button', { name: /approve github.create_issue/i });
    expect(approveBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(approveBtn);
    });

    expect(mockAddToolApprovalResponse).toHaveBeenCalledWith({ id: 'approval-abc', approved: true });
  });

  it('Deny button click calls addToolApprovalResponse with approved=false — covers lines 60, 77', async () => {
    vi.mocked(useAutomateChat).mockReturnValue({
      messages: [
        {
          id: 'm2',
          role: 'assistant',
          parts: [
            {
              type: 'tool-jira.create_issue',
              state: 'approval-requested',
              toolCallId: 'tc2',
              input: { summary: 'Test ticket' },
              approval: { id: 'approval-xyz' },
            },
          ],
        },
      ] as ReturnType<typeof useAutomateChat>['messages'],
      sendMessage: mockSendMessage,
      isLoading: false,
      error: undefined,
      regenerate: mockRegenerate,
      addToolApprovalResponse: mockAddToolApprovalResponse,
    });

    render(<ChatShell />);

    const denyBtn = await screen.findByRole('button', { name: /deny jira.create_issue/i });
    expect(denyBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(denyBtn);
    });

    expect(mockAddToolApprovalResponse).toHaveBeenCalledWith({ id: 'approval-xyz', approved: false });
  });

  it('Submit via PromptInput calls sendMessage({ text }) — covers line 48', async () => {
    vi.mocked(useAutomateChat).mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      isLoading: false,
      error: undefined,
      regenerate: mockRegenerate,
      addToolApprovalResponse: mockAddToolApprovalResponse,
    });

    render(<ChatShell />);

    const textarea = screen.getByTestId('prompt-input');
    expect(textarea).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Hello Automate' } });
    });

    const sendBtn = screen.getByRole('button', { name: /send/i });
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ text: 'Hello Automate' });
    });
  });

  it('Empty submit does NOT call sendMessage', async () => {
    vi.mocked(useAutomateChat).mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      isLoading: false,
      error: undefined,
      regenerate: mockRegenerate,
      addToolApprovalResponse: mockAddToolApprovalResponse,
    });

    render(<ChatShell />);

    // Send button should be disabled with empty textarea
    const sendBtn = screen.getByRole('button', { name: /send/i });
    expect(sendBtn).toBeDisabled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
