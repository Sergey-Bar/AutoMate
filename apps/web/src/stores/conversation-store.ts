import { createStore } from 'zustand/vanilla';

interface ConversationState {
  activeConversationId: string | null;
  setActive: (id: string) => void;
}

export function createConversationStore() {
  return createStore<ConversationState>((set) => ({
    activeConversationId: null,
    setActive: (id) => set({ activeConversationId: id }),
  }));
}
