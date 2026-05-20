import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PartyPopper, Package, Users, MapPin, DollarSign, Handshake, ClipboardCheck, Megaphone, Rocket, CheckCircle, Circle, Loader2, Eye, EyeOff, Check, Lock, ShieldCheck, type LucideIcon } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { getChecklist, seedChecklist, updateUnderbossStatus, toggleChecklistItem } from '../../lib/api';
import { AutoCompleteStates, ChecklistItem } from '../../types';
import { HostResources } from './HostResources';
import { HostsManager } from '../HostsManager';
import { FindVenueModal } from '../checklist/FindVenueModal';
import { DashboardKPIs } from './DashboardKPIs';

export const GPPDashboardTab: React.FC = () => {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { party, guests, loadParty } = usePizza();
  const [autoStates, setAutoStates] = useState<AutoCompleteStates | null>(null);
  const [dbItems, setDbItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hostsExpanded, setHostsExpanded] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [findVenueOpen, setFindVenueOpen] = useState(false);

  const loadChecklist = useCallback(async () => {
    if (!party?.id) return;
    let data = await getChecklist(party.id);
    // If not yet seeded, seed defaults so due dates propagate from checklist_defaults
    if (data && !data.seeded) {
      const seedResult = await seedChecklist(party.id);
      if (seedResult) {
        const refreshed = await getChecklist(party.id);
        if (refreshed) data = refreshed;
      }
    }
    setAutoStates(data?.autoCompleteStates ?? null);
    setDbItems(data?.items ?? []);
    setLoading(false);
  }, [party?.id]);

  useEffect(() => {
    if (!party?.id) return;
    loadChecklist();
    // pancetta-31624: refetch when in-tab side effects mutate signals that drive
    // the server-computed autoStates. HostsManager expands inline (mutates
    // party.coHosts via PizzaContext) and FindVenueModal sets party.address —
    // without these deps the checkmarks stay stale until reload.
  }, [party?.id, party?.coHosts?.length, party?.address, party?.addressIsCityDefault, loadChecklist]);

  // Map known item names to Lucide icons
  const ICON_MAP: Record<string, LucideIcon> = {
    'Create Event': PartyPopper,
    'Request Party Kit': Package,
    'Build a Team': Users,
    'Find a Venue': MapPin,
    'Set Up Budget': DollarSign,
    'Find Partners': Handshake,
    'Select Pizzeria': MapPin,
    'Prepare for the Party': ClipboardCheck,
    'Post to Socials': Megaphone,
    'Throw the Party': Rocket,
    'Get reviewed for funding': ShieldCheck,
  };

  const goToTab = (tab: string) => {
    if (tab === 'details') {
      navigate(`/host/${inviteCode}`);
    } else {
      navigate(`/host/${inviteCode}/${tab}`);
    }
  };

  const handleToggleItem = async (itemId: string) => {
    if (!party?.id || togglingId) return;
    setTogglingId(itemId);
    try {
      const result = await toggleChecklistItem(party.id, itemId);
      if (result?.item) {
        setDbItems(prev => prev.map(it => it.id === itemId
          ? { ...it, completed: result.item.completed, completedAt: result.item.completedAt }
          : it));
      }
    } finally {
      setTogglingId(null);
    }
  };

  const checklist = useMemo(() => {
    if (!party || dbItems.length === 0) return [];
    return dbItems.map((item) => {
      const done = item.isAuto && item.autoRule
        ? (autoStates?.[item.autoRule as keyof AutoCompleteStates] ?? false)
        : item.completed;
      return {
        id: item.id,
        isAuto: item.isAuto,
        autoRule: item.autoRule,
        label: item.name,
        done,
        tab: item.linkTab,
        onClick: item.name === 'Build a Team' ? () => setHostsExpanded(prev => !prev) :
                 item.name === 'Find Partners' ? () => goToTab('partners') :
                 item.name === 'Find a Venue' ? () => setFindVenueOpen(true) : undefined,
        icon: ICON_MAP[item.name] ?? ClipboardCheck,
        dueDate: item.dueDate ? item.dueDate.split('T')[0] : null,
      };
    }).sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }, [party, autoStates, dbItems, party?.coHosts?.length]);

  const completedCount = checklist.filter((c) => c.done).length;
  const totalCount = checklist.length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  // Days until event
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

  return (
    <div className="space-y-6">
      {/* quattro-71244: gamified KPI block (LeaderboardPill + Milestone strip +
          ReportKPIs read-only with goals/deltas/pulse). Supersedes the legacy
          "Invited / RSVPs / Days Until / Pending Approval" 4-tile mini-grid. */}
      <DashboardKPIs party={party} guests={guests} />

      {/* Status tiles — kept separate from the KPI block because they're
          status callouts, not stats. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-theme-text">
            {daysUntil !== null ? daysUntil : '—'}
          </div>
          <div className="text-xs text-theme-text-muted">Days Until Event</div>
        </div>
        {party.underbossStatus === 'approved' && (
          <div className="card p-4 text-center border border-green-500/30">
            <div className="flex items-center justify-center gap-1.5 text-green-400">
              <Check size={20} />
              <span className="text-sm font-medium">Approved</span>
            </div>
            <div className="text-xs text-theme-text-muted mt-1">Event Status</div>
          </div>
        )}
        {/* arugula-38633 (cap-everywhere) / marzano-49102 (gate by 'go'):
            surface the effective reimbursement cap on the dashboard so hosts
            see it at a glance. The dollar value is hidden until the party has
            the 'go' event_tag — without 'go' the tile falls through to the
            "Under review" state. Clicking jumps to the Payments tab. */}
        {(() => {
          const hasGo = Array.isArray(party.eventTags) && party.eventTags.includes('go');
          const showCap = hasGo && party.effectiveReimbursementCapUsd != null;
          return (
            <button
              type="button"
              onClick={() => goToTab('payments')}
              className="card p-4 text-center hover:bg-theme-surface-hover transition-colors cursor-pointer"
              title={showCap
                ? 'Reimbursement cap — click to open the Payments tab'
                : 'Your underboss is reviewing your event — click to open the Payments tab'}
            >
              {showCap ? (
                <>
                  <div className="text-2xl font-bold text-theme-text">
                    ${Number(party.effectiveReimbursementCapUsd).toLocaleString()}
                  </div>
                  <div className="text-xs text-theme-text-muted">Reimbursement cap</div>
                </>
              ) : (
                <>
                  <div className="text-sm font-medium text-amber-400">Under review</div>
                  <div className="text-xs text-theme-text-muted mt-1">Reimbursement cap</div>
                </>
              )}
            </button>
          );
        })()}
      </div>

      {/* Rejected status callout */}
      {party.underbossStatus === 'rejected' && (
        <div className="card p-6 border border-amber-500/30 bg-amber-500/5">
          <p className="text-sm text-theme-text mb-4">
            We can't support your event financially this year, but we're happy to list your event on the site!
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                setSaving(true);
                try {
                  await updateUnderbossStatus(party.id, 'listed');
                  if (party?.inviteCode) await loadParty(party.inviteCode);
                } catch (err) {
                  console.error('Failed to update status:', err);
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
              className="btn-primary flex items-center gap-2"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : null}
              List My Event Without Funding
            </button>
            <button
              onClick={async () => {
                setSaving(true);
                try {
                  await updateUnderbossStatus(party.id, 'hidden');
                  if (party?.inviteCode) await loadParty(party.inviteCode);
                } catch (err) {
                  console.error('Failed to update status:', err);
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
              className="btn-secondary flex items-center gap-2"
            >
              Maybe Next Year
            </button>
          </div>
        </div>
      )}

      {/* Hidden status callout */}
      {party.underbossStatus === 'hidden' && (
        <div className="card p-6 border border-theme-stroke">
          <p className="text-sm text-theme-text-muted">
            Your event is currently not listed on the site.
          </p>
        </div>
      )}

      {/* Listed status callout */}
      {party.underbossStatus === 'listed' && (
        <div className="card p-6 border border-green-500/30 bg-green-500/5">
          <p className="text-sm text-green-400">
            Your event is listed as a Community event on the site. These are self funded events that will not be funded by PizzaDAO.
          </p>
        </div>
      )}

      {/* Checklist progress */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-theme-text">Event Setup</h3>
          <div className="flex items-center gap-3">
            {completedCount > 0 && (
              <button
                onClick={() => setShowCompleted(prev => !prev)}
                className="flex items-center gap-1.5 text-xs text-theme-text-muted hover:text-theme-text transition-colors"
              >
                {showCompleted ? <EyeOff size={14} /> : <Eye size={14} />}
                {showCompleted ? 'Hide' : 'Show'} completed
              </button>
            )}
            <span className="text-sm text-theme-text-muted">
              {completedCount}/{totalCount}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-theme-surface-hover rounded-full mb-6 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progressPct}%`,
              background: progressPct === 100 ? '#22c55e' : '#ff393a',
            }}
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" />
          </div>
        ) : (
          <div className="space-y-1">
            {checklist.filter(item => showCompleted || !item.done).map((item) => {
              const Icon = item.icon;
              const clickable = item.tab || item.onClick;
              const handleRowAction = item.onClick || (item.tab ? () => goToTab(item.tab!) : undefined);
              const baseCircle = item.done ? (
                <CheckCircle size={18} className="text-green-500 shrink-0" />
              ) : (
                <Circle size={18} className="text-theme-text-faint shrink-0" />
              );
              return (
                <React.Fragment key={item.label}>
                  <div
                    onClick={clickable && handleRowAction ? handleRowAction : undefined}
                    onKeyDown={clickable && handleRowAction ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleRowAction();
                      }
                    } : undefined}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left group ${
                      clickable ? 'hover:bg-theme-surface cursor-pointer' : ''
                    }`}
                  >
                    {item.isAuto ? (
                      <span
                        title="Auto-completes based on event setup"
                        className="relative inline-flex shrink-0"
                      >
                        {baseCircle}
                        <Lock
                          size={9}
                          className="absolute -bottom-0.5 -right-0.5 text-theme-text-muted bg-theme-surface rounded-full p-px"
                        />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleToggleItem(item.id); }}
                        disabled={togglingId === item.id}
                        aria-label={`Mark ${item.label} ${item.done ? 'incomplete' : 'complete'}`}
                        className="shrink-0 hover:opacity-70 transition-opacity disabled:opacity-50"
                      >
                        {baseCircle}
                      </button>
                    )}
                    <Icon size={16} className={item.done ? 'text-theme-text-muted shrink-0' : 'text-theme-text-secondary shrink-0'} />
                    <span
                      className={`text-sm ${
                        item.done ? 'text-theme-text-muted line-through' : 'text-theme-text'
                      }`}
                    >
                      {item.label}
                    </span>
                    {item.dueDate && (
                      <span className={`text-xs ml-auto mr-2 ${
                        item.done
                          ? 'text-theme-text-faint'
                          : new Date(item.dueDate + 'T23:59:59') < new Date()
                            ? 'text-[#ff393a] font-medium'
                            : 'text-theme-text-faint'
                      }`}>
                        {new Date(item.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                    {clickable && (
                      <span className={`${item.dueDate ? '' : 'ml-auto'} text-xs text-theme-text-faint group-hover:text-theme-text-muted transition-colors`}>
                        {item.label === 'Build a Team' && hostsExpanded ? '\u25B2' : 'Go \u2192'}
                      </span>
                    )}
                  </div>
                  {item.label === 'Build a Team' && hostsExpanded && (
                    <div className="ml-9 mr-3 mb-2 mt-1 p-4 bg-theme-surface rounded-xl border border-theme-stroke animate-fade-in">
                      <HostsManager
                        partyId={party.id}
                        hostName={party.hostName || ''}
                        initialCoHosts={party.coHosts || []}
                      />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      <FindVenueModal
        open={findVenueOpen}
        onClose={() => setFindVenueOpen(false)}
        onSaved={loadChecklist}
      />

      {/* Host Resources */}
      <HostResources />
    </div>
  );
};
