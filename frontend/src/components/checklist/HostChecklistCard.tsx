import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle, Circle, Loader2, Eye, EyeOff, Lock } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { getChecklist, seedChecklist, toggleChecklistItem } from '../../lib/api';
import { AutoCompleteStates, ChecklistItem } from '../../types';
import { HostsManager } from '../HostsManager';
import { FindVenueModal } from './FindVenueModal';
import { EstimatedAttendanceModal } from './EstimatedAttendanceModal';
import { SocialPostModal } from './SocialPostModal';
import { resolveChecklistAction, hostTabPath, sortByDueDate, ChecklistVariant } from './checklistActions';
import { checklistIcon, checklistLabel } from './checklistIcons';

/**
 * The host-dashboard "Event Setup" checklist card. Extracted from
 * GPPDashboardTab (brand-checklists) so brand-series dashboards render the
 * exact same list: same seeding, progress bar, auto-complete locks, manual
 * toggles, due dates, show/hide completed, and row actions.
 */
interface HostChecklistCardProps {
  /** 'gpp' = original GPP dashboard behavior; 'series' = brand-series parties. */
  variant: ChecklistVariant;
}

export const HostChecklistCard: React.FC<HostChecklistCardProps> = ({ variant }) => {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { party } = usePizza();
  const [autoStates, setAutoStates] = useState<AutoCompleteStates | null>(null);
  const [dbItems, setDbItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hostsExpanded, setHostsExpanded] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [findVenueOpen, setFindVenueOpen] = useState(false);
  const [attendanceModalOpen, setAttendanceModalOpen] = useState(false);
  const [socialModalOpen, setSocialModalOpen] = useState(false);

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
    // without these deps the checkmarks stay stale until reload. party.date
    // drives brand-series relative due dates.
  }, [party?.id, party?.coHosts?.length, party?.address, party?.addressIsCityDefault, party?.date, loadChecklist]);

  const goToTab = useCallback((tab: string) => {
    if (inviteCode) navigate(hostTabPath(inviteCode, tab));
  }, [inviteCode, navigate]);

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
    return sortByDueDate(dbItems.map((item) => {
      const done = item.isAuto && item.autoRule
        ? (autoStates?.[item.autoRule as keyof AutoCompleteStates] ?? false)
        : item.completed;
      const action = resolveChecklistAction(item, variant);
      const onClick: (() => void) | undefined =
        action?.kind === 'hosts' ? () => setHostsExpanded(prev => !prev)
        : action?.kind === 'venue-modal' ? () => setFindVenueOpen(true)
        : action?.kind === 'attendance-modal' ? () => setAttendanceModalOpen(true)
        : action?.kind === 'social-modal' ? () => setSocialModalOpen(true)
        : action?.kind === 'tab' ? () => goToTab(action.tab)
        : undefined;
      return {
        id: item.id,
        isAuto: item.isAuto,
        label: checklistLabel(item),
        done,
        isHosts: action?.kind === 'hosts',
        onClick,
        icon: checklistIcon(item, variant),
        dueDate: item.dueDate ? item.dueDate.split('T')[0] : null,
      };
    }));
  }, [party, autoStates, dbItems, goToTab, variant]);

  const completedCount = checklist.filter((c) => c.done).length;
  const totalCount = checklist.length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  if (!party) return null;

  return (
    <>
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
              const handleRowAction = item.onClick;
              const clickable = !!handleRowAction;
              const baseCircle = item.done ? (
                <CheckCircle size={18} className="text-green-500 shrink-0" />
              ) : (
                <Circle size={18} className="text-theme-text-faint shrink-0" />
              );
              return (
                <React.Fragment key={item.id}>
                  <div
                    onClick={handleRowAction}
                    onKeyDown={handleRowAction ? (e) => {
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
                        {item.isHosts && hostsExpanded ? '▲' : 'Go →'}
                      </span>
                    )}
                  </div>
                  {item.isHosts && hostsExpanded && (
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

      <EstimatedAttendanceModal
        open={attendanceModalOpen}
        onClose={() => setAttendanceModalOpen(false)}
        partyId={party.id}
        currentEstimate={party.estimatedAttendance ?? null}
        onSaved={loadChecklist}
      />

      <SocialPostModal
        open={socialModalOpen}
        onClose={() => setSocialModalOpen(false)}
        party={party}
      />
    </>
  );
};
