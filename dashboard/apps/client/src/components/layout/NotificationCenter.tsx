import { useState, useRef, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotificationStore, type Notification } from '@/store/notificationStore';
import { ease } from '@/lib/motion';
import { timeAgo } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { notifications, unreadCount, markRead, markAllRead, clear } = useNotificationStore();

  // Close on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {/* Bell trigger */}
      <button
        onClick={() => { setOpen((v) => !v); }}
        className="relative p-1.5 rounded hover:bg-white/5 transition-colors"
        aria-label={`Notifications (${unreadCount} unread)`}
      >
        <Bell size={16} className="text-text-tertiary" />
        {unreadCount > 0 && (
          <span className={cn('absolute -top-0.5 -right-0.5 w-4 h-4 text-[9px] font-bold flex items-center justify-center rounded-full', 'bg-fail')} style={{ color: '#fff' }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Popover */}
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-center-title"
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={ease.standard}
            className={cn('absolute right-0 top-full mt-2 w-80 rounded-xl border shadow-xl z-50 overflow-hidden', 'bg-bg-surface border-border-default')}
          >
            {/* Header */}
            <div
              className={cn('flex items-center justify-between px-4 py-2.5 border-b', 'border-border-subtle')}
            >
              <p id="notification-center-title" className="text-xs font-semibold text-text-primary">
                Notifications
              </p>
              <div className="flex gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className={cn('text-[10px] font-medium hover:underline', 'text-running')}
                  >
                    Mark all read
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={clear}
                    className={cn('text-[10px] font-medium hover:underline', 'text-text-tertiary')}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className={cn('text-center py-8 text-xs', 'text-text-tertiary')}>
                  No notifications yet
                </div>
              ) : (
                notifications.map((n) => (
                  <NotificationRow key={n.id} notification={n} onRead={() => markRead(n.id)} />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NotificationRow({
  notification: n,
  onRead,
}: {
  notification: Notification;
  onRead: () => void;
}) {
  const iconMap: Record<string, string> = {
    'run:end': '🏁',
    failure: '✕',
    regression: '📉',
    info: 'ℹ',
  };

  return (
    <div
      onClick={onRead}
      className={cn('flex gap-3 px-4 py-2.5 border-b cursor-pointer hover:bg-white/2 transition-colors', 'border-border-subtle')}
      style={{
        background: !n.read ? 'oklch(0.68 0.19 250 / 3%)' : undefined,
      }}
    >
      <span className="mt-0.5 text-sm shrink-0">{iconMap[n.type] ?? 'ℹ'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate text-text-primary">
          {n.title}
        </p>
        {n.description && (
          <p className="text-[11px] truncate text-text-tertiary">
            {n.description}
          </p>
        )}
        <p className="text-[10px] mt-0.5 text-text-tertiary">
          {timeAgo(new Date(n.timestamp).toISOString())}
        </p>
      </div>
      {!n.read && (
        <span className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', 'bg-running')} />
      )}
    </div>
  );
}
