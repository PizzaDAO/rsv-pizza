import React, { useEffect, useState } from 'react';
import { ListChecks, ChevronRight, Loader2 } from 'lucide-react';
import { ChecklistItem } from '../../types';
import { getChecklist } from '../../lib/api';

interface ChecklistTodayCardProps {
  partyId: string;
  inviteCode: string;
  hideOpenTabLink?: boolean;
}

/**
 * Day-of subset of the checklist — only items in the allowlist below that
 * are still un-done. Items renamed/rewritten by the host won't match this
 * list and won't appear (acceptable v1 trade-off).
 */
const DAY_OF_ITEM_NAMES = new Set([
  'Confirm pizza delivery time',
  'Set up check-in table',
  'Test sound system',
  'Greet first guests',
  'Take group photo',
  'Pay venue final invoice',
]);

export const ChecklistTodayCard: React.FC<ChecklistTodayCardProps> = ({
  partyId,
  inviteCode,
  hideOpenTabLink,
}) => {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getChecklist(partyId)
      .then((data) => {
        if (cancelled) return;
        setItems(data?.items || []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [partyId]);

  const todays = items.filter(
    (i) => !i.completed && DAY_OF_ITEM_NAMES.has(i.name)
  );

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListChecks size={18} className="text-[#ff393a]" />
          <h3 className="text-lg font-semibold text-theme-text">Today's checklist</h3>
        </div>
        {!hideOpenTabLink && (
          <a
            href={`/host/${inviteCode}?tab=checklist`}
            className="inline-flex items-center text-sm text-theme-text-secondary hover:text-theme-text"
          >
            Open
            <ChevronRight size={14} />
          </a>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-theme-text-muted">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </div>
      ) : todays.length === 0 ? (
        <p className="text-sm text-theme-text-muted italic">
          All day-of items are done.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {todays.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 text-sm text-theme-text py-1"
            >
              <span className="w-2 h-2 rounded-full bg-[#ff393a] flex-shrink-0" />
              {item.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
