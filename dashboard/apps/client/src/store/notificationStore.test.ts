/// <reference types="vitest" />
import { describe, it, expect, beforeEach } from 'vitest';
import { useNotificationStore } from './notificationStore';

describe('notificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [], unreadCount: 0 });
  });

  describe('initial state', () => {
    it('starts with empty notifications', () => {
      const state = useNotificationStore.getState();
      expect(state.notifications).toEqual([]);
      expect(state.unreadCount).toBe(0);
    });
  });

  describe('push', () => {
    it('adds a notification', () => {
      useNotificationStore.getState().push({ type: 'info', title: 'Hello' });
      const state = useNotificationStore.getState();
      expect(state.notifications).toHaveLength(1);
      expect(state.notifications[0].title).toBe('Hello');
      expect(state.notifications[0].type).toBe('info');
      expect(state.notifications[0].read).toBe(false);
    });

    it('increments unread count', () => {
      useNotificationStore.getState().push({ type: 'info', title: 'One' });
      useNotificationStore.getState().push({ type: 'info', title: 'Two' });
      expect(useNotificationStore.getState().unreadCount).toBe(2);
    });

    it('prepends new notifications (newest first)', () => {
      useNotificationStore.getState().push({ type: 'info', title: 'First' });
      useNotificationStore.getState().push({ type: 'info', title: 'Second' });
      const notifications = useNotificationStore.getState().notifications;
      expect(notifications[0].title).toBe('Second');
      expect(notifications[1].title).toBe('First');
    });

    it('generates unique ids', () => {
      useNotificationStore.getState().push({ type: 'info', title: 'A' });
      useNotificationStore.getState().push({ type: 'info', title: 'B' });
      const notifications = useNotificationStore.getState().notifications;
      expect(notifications[0].id).not.toBe(notifications[1].id);
    });

    it('sets timestamp', () => {
      // eslint-disable-next-line test-flakiness/no-random-data
      const before = Date.now();
      useNotificationStore.getState().push({ type: 'info', title: 'Test' });
      // eslint-disable-next-line test-flakiness/no-random-data
      const after = Date.now();
      const ts = useNotificationStore.getState().notifications[0].timestamp;
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('supports optional fields', () => {
      useNotificationStore.getState().push({
        type: 'run:end',
        title: 'Run done',
        description: 'All passed',
        runId: 'run-1',
      });
      const n = useNotificationStore.getState().notifications[0];
      expect(n.description).toBe('All passed');
      expect(n.runId).toBe('run-1');
    });

    it('caps at 100 notifications', () => {
      for (let i = 0; i < 110; i++) {
        useNotificationStore.getState().push({ type: 'info', title: `N${i}` });
      }
      expect(useNotificationStore.getState().notifications).toHaveLength(100);
    });

    it('keeps newest notifications when capped', () => {
      for (let i = 0; i < 110; i++) {
        useNotificationStore.getState().push({ type: 'info', title: `N${i}` });
      }
      const notifications = useNotificationStore.getState().notifications;
      // The newest should be N109 (last pushed)
      expect(notifications[0].title).toBe('N109');
    });
  });

  describe('markRead', () => {
    it('marks a specific notification as read', () => {
      useNotificationStore.getState().push({ type: 'info', title: 'Test' });
      const id = useNotificationStore.getState().notifications[0].id;
      useNotificationStore.getState().markRead(id);
      expect(useNotificationStore.getState().notifications[0].read).toBe(true);
    });

    it('decrements unread count', () => {
      useNotificationStore.getState().push({ type: 'info', title: 'A' });
      useNotificationStore.getState().push({ type: 'info', title: 'B' });
      expect(useNotificationStore.getState().unreadCount).toBe(2);

      const id = useNotificationStore.getState().notifications[0].id;
      useNotificationStore.getState().markRead(id);
      expect(useNotificationStore.getState().unreadCount).toBe(1);
    });

    it('does not affect other notifications', () => {
      useNotificationStore.getState().push({ type: 'info', title: 'A' });
      useNotificationStore.getState().push({ type: 'info', title: 'B' });
      const id = useNotificationStore.getState().notifications[0].id;
      useNotificationStore.getState().markRead(id);

      expect(useNotificationStore.getState().notifications[1].read).toBe(false);
    });
  });

  describe('markAllRead', () => {
    it('marks all notifications as read', () => {
      useNotificationStore.getState().push({ type: 'info', title: 'A' });
      useNotificationStore.getState().push({ type: 'info', title: 'B' });
      useNotificationStore.getState().push({ type: 'info', title: 'C' });

      useNotificationStore.getState().markAllRead();
      const state = useNotificationStore.getState();
      expect(state.unreadCount).toBe(0);
      expect(state.notifications.every((n) => n.read)).toBe(true);
    });
  });

  describe('clear', () => {
    it('removes all notifications', () => {
      useNotificationStore.getState().push({ type: 'info', title: 'A' });
      useNotificationStore.getState().push({ type: 'info', title: 'B' });
      useNotificationStore.getState().clear();

      const state = useNotificationStore.getState();
      expect(state.notifications).toEqual([]);
      expect(state.unreadCount).toBe(0);
    });
  });
});
