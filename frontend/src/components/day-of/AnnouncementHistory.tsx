import React, { useEffect, useState } from 'react';
import { History, Loader2, MessageCircle, Mail } from 'lucide-react';
import { listDayOfAnnouncements, DayOfAnnouncement } from '../../lib/api';

interface AnnouncementHistoryProps {
  partyId: string;
  /** Bump this counter to force a refetch (e.g. after sending). */
  refreshKey?: number;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const AnnouncementHistory: React.FC<AnnouncementHistoryProps> = ({ partyId, refreshKey }) => {
  const [rows, setRows] = useState<DayOfAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listDayOfAnnouncements(partyId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch(() => {
        // Permissions / network issues are non-fatal — just hide history.
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [partyId, refreshKey]);

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <History size={18} className="text-[#ff393a]" />
        <h3 className="text-lg font-semibold text-theme-text">Sent today</h3>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-theme-text-muted">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-theme-text-muted italic">No announcements sent yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="border-l-2 border-[#ff393a]/40 pl-3">
              <div className="flex items-center gap-2 text-xs text-theme-text-muted">
                <span>{relativeTime(row.sentAt)}</span>
                {row.channels.includes('telegram') && (
                  <MessageCircle size={12} className="text-theme-text-muted" />
                )}
                {row.channels.includes('email') && (
                  <>
                    <Mail size={12} className="text-theme-text-muted" />
                    {row.recipientCount != null && <span>{row.recipientCount}</span>}
                  </>
                )}
              </div>
              {row.subject && (
                <p className="text-sm font-semibold text-theme-text mt-1">{row.subject}</p>
              )}
              <p className="text-sm text-theme-text-secondary line-clamp-2 mt-0.5">
                {row.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
