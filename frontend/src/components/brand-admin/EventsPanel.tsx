import React, { useCallback, useEffect, useState } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { Checkbox } from '../Checkbox';
import {
  fetchBrandEvents, setBrandEventStatus, setBrandOwnAlerts, describeApiError, PIZZADAO_VETO_MESSAGE,
  type BrandEvent,
} from '../../lib/brandAdminApi';

const STATUSES: Array<{ value: string; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'listed', label: 'Listed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'hidden', label: 'Hidden' },
];

type Target = 'approved' | 'rejected' | 'hidden';
const ACTIONS: Array<{ to: Target; label: string; primary?: boolean }> = [
  { to: 'approved', label: 'Approve', primary: true },
  { to: 'rejected', label: 'Reject' },
  { to: 'hidden', label: 'Hide' },
];

interface Props {
  seriesId: string;
  /** null for a super-admin (no alert row to toggle). */
  alertsEnabled: boolean | null;
}

export const EventsPanel: React.FC<Props> = ({ seriesId, alertsEnabled }) => {
  const [status, setStatus] = useState('pending');
  const [events, setEvents] = useState<BrandEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [alerts, setAlerts] = useState<boolean | null>(alertsEnabled);
  const [alertsMsg, setAlertsMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setEvents(null);
    try {
      setEvents((await fetchBrandEvents(seriesId, status)).events);
    } catch (e) {
      setLoadError(describeApiError(e));
    }
  }, [seriesId, status]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setAlerts(alertsEnabled), [alertsEnabled]);

  const act = async (ev: BrandEvent, to: Target) => {
    setRowBusy(ev.id);
    setRowError((r) => { const n = { ...r }; delete n[ev.id]; return n; });
    try {
      await setBrandEventStatus(seriesId, ev.id, to);
      setEvents((cur) => (cur ?? []).filter((x) => x.id !== ev.id));
    } catch (e) {
      const err = e as Error & { code?: string };
      setRowError((r) => ({ ...r, [ev.id]: err.code === 'PIZZADAO_DECIDED' ? PIZZADAO_VETO_MESSAGE : describeApiError(e) }));
    } finally {
      setRowBusy(null);
    }
  };

  const toggleAlerts = async () => {
    if (alerts === null) return;
    const next = !alerts;
    setAlertsMsg(null);
    setAlerts(next);
    try {
      await setBrandOwnAlerts(seriesId, next);
      setAlertsMsg(next ? "You'll get an email when a new event needs approval." : 'Email alerts are off.');
    } catch (e) {
      setAlerts(!next);
      setAlertsMsg(describeApiError(e));
    }
  };

  return (
    <div className="space-y-4" data-testid="events-panel">
      <div className="flex items-start gap-2 text-sm text-theme-text-muted p-3 rounded-lg bg-theme-surface" data-testid="approval-note">
        <Info size={16} className="mt-0.5 shrink-0" />
        <span>
          Approving an event lists it on your site. It does <strong>not</strong> unlock payouts or kits; those stay with PizzaDAO.
          PizzaDAO can still change an event's status, and once it has, you can't change it here.
        </span>
      </div>

      {alerts !== null && (
        <div>
          <Checkbox checked={alerts} onChange={toggleAlerts} label="Email me when a new event needs approval" checkboxRole />
          {alertsMsg && <p className="text-xs text-theme-text-muted mt-1" role="status">{alertsMsg}</p>}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Event status">
        {STATUSES.map((s) => (
          <button key={s.value} type="button" role="tab" aria-selected={status === s.value} onClick={() => setStatus(s.value)}
            className={`px-3 py-2 min-h-[40px] rounded-lg text-sm whitespace-nowrap border transition-colors ${status === s.value ? 'bg-[#E52828] border-[#E52828] text-white' : 'bg-theme-surface border-theme-stroke text-theme-text hover:bg-theme-surface-hover'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="space-y-2">
          <p className="text-sm text-[#E52828]" role="alert">{loadError}</p>
          <button type="button" className="btn-secondary text-sm" onClick={load}>Try again</button>
        </div>
      )}
      {!loadError && !events && <div className="flex items-center gap-2 text-sm text-theme-text-muted"><Loader2 size={16} className="animate-spin" />Loading events…</div>}
      {events && (
        <ul className="space-y-2">
          {events.map((ev) => (
            <li key={ev.id} className="px-3 py-3 rounded-lg bg-theme-surface space-y-2" data-testid="brand-event">
              <div className="min-w-0">
                <a href={`/rsvp/${ev.customUrl || ev.inviteCode}`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-theme-text hover:underline break-words">{ev.name}</a>
                <div className="text-xs text-theme-text-muted break-words">
                  {[ev.city, ev.country].filter(Boolean).join(', ')}
                  {ev.date ? ` · ${new Date(ev.date).toLocaleDateString()}` : ''}
                  {ev.user?.email ? ` · ${ev.user.email}` : ''}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {ACTIONS.filter((a) => a.to !== ev.underbossStatus).map((a) => (
                  <button key={a.to} type="button" disabled={rowBusy === ev.id} onClick={() => act(ev, a.to)}
                    className={`${a.primary ? 'btn-primary' : 'btn-secondary'} text-sm !px-3 !py-2 min-h-[40px] disabled:opacity-50`}>
                    {a.label}
                  </button>
                ))}
              </div>
              {rowError[ev.id] && <p className="text-sm text-[#E52828]" role="alert">{rowError[ev.id]}</p>}
            </li>
          ))}
          {events.length === 0 && <li className="text-sm text-theme-text-muted">No {status} events.</li>}
        </ul>
      )}
    </div>
  );
};
