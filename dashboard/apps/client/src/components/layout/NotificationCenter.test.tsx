import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '@/test/test-utils';
import { NotificationCenter } from './NotificationCenter';
import { useNotificationStore, type Notification } from '@/store/notificationStore';

const mockMarkRead = vi.fn();
const mockMarkAllRead = vi.fn();
const mockClear = vi.fn();

// Hoisted mock for Zustand store
vi.mock('@/store/notificationStore', () => ({
  useNotificationStore: vi.fn(),
}));

describe('NotificationCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementation
    vi.mocked(useNotificationStore).mockReturnValue({
      notifications: [],
      unreadCount: 0,
      markRead: mockMarkRead,
      markAllRead: mockMarkAllRead,
      clear: mockClear,
    });
  });

  it('renders with no notifications (empty state)', () => {
    renderWithProviders(<NotificationCenter />);
    
    const trigger = screen.getByRole('button', { name: 'Notifications (0 unread)' });
    expect(trigger).toBeInTheDocument();
    
    fireEvent.click(trigger);
    
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('No notifications yet')).toBeInTheDocument();
  });

  it('renders a notification item when data is provided', () => {
    const notifications: Notification[] = [
      {
        id: 'n1',
        type: 'run:end',
        title: 'Run Finished',
        description: 'All 10 tests passed',
        read: false,
        timestamp: 1693132800000 - 60000, // 1 min ago
      }
    ];

    vi.mocked(useNotificationStore).mockReturnValue({
      notifications,
      unreadCount: 1,
      markRead: mockMarkRead,
      markAllRead: mockMarkAllRead,
      clear: mockClear,
    });

    renderWithProviders(<NotificationCenter />);
    
    const trigger = screen.getByRole('button', { name: 'Notifications (1 unread)' });
    expect(trigger).toBeInTheDocument();
    
    fireEvent.click(trigger);
    
    expect(screen.getByText('Run Finished')).toBeInTheDocument();
    expect(screen.getByText('All 10 tests passed')).toBeInTheDocument();
    expect(screen.getByText('Mark all read')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('shows and dismisses notification interaction correctly', () => {
    const notifications: Notification[] = [
      {
        id: 'n2',
        type: 'failure',
        title: 'Test Failed',
        read: false,
        timestamp: 1693132800000,
      }
    ];

    vi.mocked(useNotificationStore).mockReturnValue({
      notifications,
      unreadCount: 1,
      markRead: mockMarkRead,
      markAllRead: mockMarkAllRead,
      clear: mockClear,
    });

    renderWithProviders(<NotificationCenter />);
    
    fireEvent.click(screen.getByRole('button', { name: 'Notifications (1 unread)' }));

    // Click the notification row to read it
    const row = screen.getByText('Test Failed');
    fireEvent.click(row);
    expect(mockMarkRead).toHaveBeenCalledWith('n2');
    
    // Click action buttons
    fireEvent.click(screen.getByText('Mark all read'));
    expect(mockMarkAllRead).toHaveBeenCalled();
    
    fireEvent.click(screen.getByText('Clear'));
    expect(mockClear).toHaveBeenCalled();
  });

  it('closes popover on outside click or Escape key', async () => {
    renderWithProviders(<NotificationCenter />);
    
    const trigger = screen.getByRole('button', { name: 'Notifications (0 unread)' });
    
    // Open
    fireEvent.click(trigger);
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    
    // Escape to close
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
    });
    
    // Open again
    fireEvent.click(trigger);
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    
    // Outside click to close
    fireEvent.pointerDown(document.body);
    await waitFor(() => {
      expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
    });
  });

  it('provides basic accessibility roles and aria checks', () => {
    renderWithProviders(<NotificationCenter />);
    
    const trigger = screen.getByRole('button', { name: 'Notifications (0 unread)' });
    fireEvent.click(trigger);
    
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'notification-center-title');
    
    const title = screen.getByText('Notifications');
    expect(title).toHaveAttribute('id', 'notification-center-title');
  });
});
