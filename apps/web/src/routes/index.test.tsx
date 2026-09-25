import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('@/hooks/use-automate-chat.js', () => ({
  useAutomateChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    isLoading: false,
    error: null,
    regenerate: vi.fn(),
    addToolApprovalResponse: vi.fn(),
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({}),
}));

import { ChatPage } from './index.js';

describe('ChatPage', () => {
  it('renders without crashing', () => {
    const html = renderToString(<ChatPage />);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });
});
