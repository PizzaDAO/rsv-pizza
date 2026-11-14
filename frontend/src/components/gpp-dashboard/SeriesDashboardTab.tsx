import React, { useMemo } from 'react';
import { Check } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { HostChecklistCard } from '../checklist/HostChecklistCard';

/**
 * brand-checklists: host landing dashboard for brand-series parties (Team1,
 * Monad, Doge Day, ...). Same "Event Setup" task list as the GPP dashboard
 * (HostChecklistCard), plus the brand-neutral status tiles. The GPP-only parts
 * (leaderboard KPIs, PizzaDAO reimbursement cap, payouts, funding callouts,
 * GPP host resources) are intentionally left out.
 */
export const SeriesDashboardTab: React.FC = () => {
  const { party } = usePizza();

  const daysUntil = useMemo(() => {
    if (!party?.date) return null;
    const eventDate = new Date(party.date.slice(0, 10) + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = eventDate.getTime() - today.getTime();
    if (diff < 0) return null;
    return Math.round(diff / (1000 * 60 * 60 * 24));
  }, [party?.date]);

  if (!party) return null;

  const status = party.underbossStatus;
  const approved = status === 'approved' || status === 'listed';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-theme-text">
            {daysUntil !== null ? daysUntil : '—'}
          </div>
          <div className="text-xs text-theme-text-muted">Days Until Event</div>
        </div>
        <div className={`card p-4 text-center ${approved ? 'border border-green-500/30' : ''}`}>
          {approved ? (
            <div className="flex items-center justify-center gap-1.5 text-green-400">
              <Check size={20} />
              <span className="text-sm font-medium">Approved</span>
            </div>
          ) : (
            <div className="text-sm font-medium text-amber-400">
              {status === 'rejected' ? 'Not approved' : 'Under review'}
            </div>
          )}
          <div className="text-xs text-theme-text-muted mt-1">Event Status</div>
        </div>
      </div>

      <HostChecklistCard variant="series" />
    </div>
  );
};
