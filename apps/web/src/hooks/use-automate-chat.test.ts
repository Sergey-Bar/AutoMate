import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseChat, MockDefaultChatTransport, mockLastAssistant } = vi.hoisted(() => ({
  mockUseChat: vi.fn(),
  MockDefaultChatTransport: vi.fn(),
  mockLastAssistant: vi.fn(),
}));

vi.mock('@ai-sdk/react', () => ({
  useChat: mockUseChat,
}));

vi.mock('ai', () => ({
  DefaultChatTransport: MockDefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses: mockLastAssistant,
}));

import { chatApiPath, useAutomateChat } from './use-automate-chat.js';

type MockChat = {
  messages: Array<{ id: string; role: string; parts: unknown[] }>;
  sendMessage: ReturnType<typeof vi.fn>;
  status: string;
  error: Error | null;
  regenerate: ReturnType<typeof vi.fn>;
  addToolApprovalResponse: ReturnType<typeof vi.fn>;
};

function createMockChat(overrides: Partial<MockChat> = {}): MockChat {
  return {
    messages: [{ id: 'm1', role: 'assistant', parts: [] }],
    sendMessage: vi.fn(),
    status: 'ready',
    error: null,
    regenerate: vi.fn(),
    addToolApprovalResponse: vi.fn(),
    ...overrides,
  };
}

describe('useAutomateChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockDefaultChatTransport.mockImplementation(function createTransport(config) {
      return {
        __transport: true,
        config,
      };
    });
    mockUseChat.mockReturnValue(createMockChat());
  });

  it('targets /api/chat endpoint', () => {
    expect(chatApiPath).toBe('/api/chat');
  });

  it('creates DefaultChatTransport with api path and no body when no conversationId', () => {
    useAutomateChat();

    expect(MockDefaultChatTransport).toHaveBeenCalledTimes(1);
    expect(MockDefaultChatTransport).toHaveBeenCalledWith({
      api: '/api/chat',
      body: undefined,
    });
  });

  it('creates DefaultChatTransport with body containing conversationId when provided', () => {
    useAutomateChat('conv-123');

    expect(MockDefaultChatTransport).toHaveBeenCalledTimes(1);
    expect(MockDefaultChatTransport).toHaveBeenCalledWith({
      api: '/api/chat',
      body: { conversationId: 'conv-123' },
    });
  });

  it('calls useChat with transport and sendAutomaticallyWhen callback', () => {
    useAutomateChat('conv-abc');

    const createdTransport = MockDefaultChatTransport.mock.results[0]?.value;
    expect(mockUseChat).toHaveBeenCalledTimes(1);
    expect(mockUseChat).toHaveBeenCalledWith({
      transport: createdTransport,
      sendAutomaticallyWhen: mockLastAssistant,
    });
  });

  it('returns messages from chat', () => {
    const messages = [{ id: 'm2', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }];
    mockUseChat.mockReturnValue(createMockChat({ messages }));

    const result = useAutomateChat();

    expect(result.messages).toBe(messages);
  });

  it("returns isLoading=true when status is 'streaming'", () => {
    mockUseChat.mockReturnValue(createMockChat({ status: 'streaming' }));

    const result = useAutomateChat();

    expect(result.isLoading).toBe(true);
  });

  it("returns isLoading=false when status is not 'streaming'", () => {
    mockUseChat.mockReturnValue(createMockChat({ status: 'ready' }));

    const result = useAutomateChat();

    expect(result.isLoading).toBe(false);
  });

  it('returns error and chat actions from useChat result', () => {
    const error = new Error('chat failed');
    const sendMessage = vi.fn();
    const regenerate = vi.fn();
    const addToolApprovalResponse = vi.fn();

    mockUseChat.mockReturnValue(
      createMockChat({
        error,
        sendMessage,
        regenerate,
        addToolApprovalResponse,
      }),
    );

    const result = useAutomateChat();

    expect(result.error).toBe(error);
    expect(result.sendMessage).toBe(sendMessage);
    expect(result.regenerate).toBe(regenerate);
    expect(result.addToolApprovalResponse).toBe(addToolApprovalResponse);
  });
});
