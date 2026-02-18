'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Notification } from '@/types';

interface NotificationBellProps {
  userId: string;
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const supabase = createClient();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  // ── Load + subscribe ───────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (data) setNotifications(data as Notification[]);
    };

    load();

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setNotifications(prev => [payload.new as Notification, ...prev].slice(0, 20));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  // ── Close on outside click ─────────────────────────────────
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Mark all read ──────────────────────────────────────────
  const markAllRead = async () => {
    await supabase.rpc('mark_notifications_read', { p_user_id: userId });
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const handleOpen = () => {
    setIsOpen(v => !v);
    if (!isOpen && unreadCount > 0) markAllRead();
  };

  return (
    <div ref={panelRef} className="relative">
      {/* Bell button */}
      <button
        type="button"
        onClick={handleOpen}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl
                   border border-neutral-800 bg-neutral-900 text-neutral-400
                   hover:border-neutral-700 hover:text-neutral-200 transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center
                           rounded-full bg-amber-500 text-[9px] font-bold text-black">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl border border-neutral-800
                        bg-neutral-950 shadow-2xl shadow-black/50 overflow-hidden">
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <p className="text-sm font-semibold text-neutral-200">Notifications</p>
            {unreadCount === 0 && notifications.length > 0 && (
              <span className="text-xs text-neutral-600">All caught up</span>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-neutral-600">No notifications yet</p>
              </div>
            ) : (
              notifications.map(n => (
                <NotificationItem key={n.id} notification={n} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({ notification: n }: { notification: Notification }) {
  const iconMap: Record<string, string> = {
    job_completed:           '✅',
    job_failed:              '❌',
    credits_low:             '⚠️',
    credits_depleted:        '🪫',
    subscription_renewed:    '🔄',
    subscription_cancelled:  '🚫',
    churn_discount_offered:  '🎁',
  };

  const icon = iconMap[n.type] ?? '🔔';
  const timeAgo = formatRelative(n.created_at);

  return (
    <a
      href={n.cta_url ?? '#'}
      className={[
        'flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900 transition-colors',
        !n.is_read ? 'bg-amber-500/5' : '',
      ].join(' ')}
    >
      <span className="text-base flex-shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${!n.is_read ? 'font-semibold text-neutral-100' : 'text-neutral-300'}`}>
          {n.title}
        </p>
        {n.body && (
          <p className="text-xs text-neutral-500 mt-0.5 truncate">{n.body}</p>
        )}
        <p className="text-[10px] text-neutral-700 mt-1">{timeAgo}</p>
      </div>
      {!n.is_read && (
        <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-amber-400" />
      )}
    </a>
  );
}

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min  = Math.floor(diff / 60000);
  const hr   = Math.floor(diff / 3600000);
  const day  = Math.floor(diff / 86400000);
  if (min < 1)  return 'Just now';
  if (min < 60) return `${min}m ago`;
  if (hr < 24)  return `${hr}h ago`;
  return `${day}d ago`;
}
