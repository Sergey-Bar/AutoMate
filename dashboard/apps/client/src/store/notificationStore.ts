import { create } from 'zustand';

export interface Notification {
  id: string;
  type: 'run:end' | 'failure' | 'regression' | 'info';
  title: string;
  description?: string;
  runId?: string;
  read: boolean;
  timestamp: number;
}

interface NotificationStore {
  notifications: Notification[];
  unreadCount: number;
  push: (n: Omit<Notification, 'id' | 'read' | 'timestamp'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

let _id = 0;

export const useNotificationStore = create<NotificationStore>((set, _get) => ({
  notifications: [],
  unreadCount: 0,

  push: (n) => {
    const id = `notif-${++_id}-${Date.now()}`;
    const entry: Notification = { ...n, id, read: false, timestamp: Date.now() };
    set((s) => ({
      notifications: [entry, ...s.notifications].slice(0, 100),
      unreadCount: s.unreadCount + 1,
    }));
  },

  markRead: (id) =>
    set((s) => {
      const nots = s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
      return { notifications: nots, unreadCount: nots.filter((n) => !n.read).length };
    }),

  markAllRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),

  clear: () => set({ notifications: [], unreadCount: 0 }),
}));
