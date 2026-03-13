import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PartyPopper, Package, Users, MapPin, DollarSign, Handshake, ClipboardCheck, Megaphone, Rocket, CheckCircle, Circle, Loader2, Eye, EyeOff } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { getChecklist } from '../../lib/api';
import { AutoCompleteStates } from '../../types';
import { HostResources } from './HostResources';
import { HostsManager } from '../HostsManager';

export const GPPDashboardTab: React.FC = () => {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { party, guests } = usePizza();
  const [autoStates, setAutoStates] = useState<AutoCompleteStates | null>(null);
  const [loading, setLoading] = useState(true);
  const [hostsExpanded, setHostsExpanded] = useState(false);
  const [coHostCount, setCoHostCount] = useState(party?.coHosts?.length ?? 0);
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    if (!party?.id) return;
    let cancelled = false;
    (async () => {
      const data = await getChecklist(party.id);
      if (!cancelled) {
        setAutoStates(data?.autoCompleteStates ?? null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [party?.id]);

  const goToTab = (tab: string) => {
    if (tab === 'details') {
      navigate(`/host/${inviteCode}`);
    } else {
      navigate(`/host/${inviteCode}/${tab}`);
    }
  };

  const checklist = useMemo(() => {
    if (!party) return [];
    return [
      {
        label: 'Create Event',
        done: true,
        tab: null,
        icon: PartyPopper,
        dueDate: null,
      },
      {
        label: 'Request Party Kit',
        done: autoStates?.party_kit_submitted ?? false,
        tab: 'gpp',
        icon: Package,
        dueDate: '2026-03-17',
      },
      {
        label: 'Build a Team',
        done: autoStates?.team_built ?? false,
        tab: null,
        onClick: () => setHostsExpanded(prev => !prev),
        icon: Users,
        dueDate: '2026-03-30',
      },
      {
        label: 'Find a Venue',
        done: autoStates?.venue_added ?? !!party.venueName,
        tab: 'venue',
        icon: MapPin,
        dueDate: '2026-04-08',
      },
      {
        label: 'Set Up Budget',
        done: autoStates?.budget_submitted ?? false,
        tab: 'budget',
        icon: DollarSign,
        dueDate: '2026-04-18',
      },
      {
        label: 'Find Partners',
        done: false,
        tab: 'sponsors',
        icon: Handshake,
        dueDate: '2026-03-15',
      },
      {
        label: 'Prepare for the Party',
        done: false,
        tab: null,
        icon: ClipboardCheck,
        dueDate: '2026-04-20',
      },
      {
        label: 'Post to Socials',
        done: false,
        tab: 'promo',
        icon: Megaphone,
        dueDate: '2026-04-22',
      },
      {
        label: 'Throw the Party',
        done: false,
        tab: null,
        icon: Rocket,
        dueDate: '2026-05-22',
      },
    ];
  }, [party, autoStates, coHostCount]);

  const completedCount = checklist.filter((c) => c.done).length;
  const totalCount = checklist.length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  // Days until event
  const daysUntil = useMemo(() => {
    if (!party?.date) return null;
    const diff = new Date(party.date).getTime() - Date.now();
    if (diff < 0) return null;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }, [party?.date]);

  if (!party) return null;

  return (
    <div className="space-y-6">
      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-theme-text">{guests.length}</div>
          <div className="text-xs text-theme-text-muted">RSVPs</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-theme-text">
            {daysUntil !== null ? daysUntil : '—'}
          </div>
          <div className="text-xs text-theme-text-muted">Days Until Event</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-theme-text">
            {guests.filter((g) => g.status === 'PENDING').length}
          </div>
          <div className="text-xs text-theme-text-muted">Pending Approval</div>
        </div>
      </div>

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
              const Wrapper = clickable ? 'button' : 'div';
              return (
                <React.Fragment key={item.label}>
                  <Wrapper
                    onClick={clickable ? (item.onClick || (() => goToTab(item.tab!))) : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left group ${
                      clickable ? 'hover:bg-theme-surface cursor-pointer' : ''
                    }`}
                  >
                    {item.done ? (
                      <CheckCircle size={18} className="text-green-500 shrink-0" />
                    ) : (
                      <Circle size={18} className="text-theme-text-faint shrink-0" />
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
                  </Wrapper>
                  {item.label === 'Build a Team' && hostsExpanded && (
                    <div className="ml-9 mr-3 mb-2 mt-1 p-4 bg-theme-surface rounded-xl border border-theme-stroke animate-fade-in">
                      <HostsManager
                        partyId={party.id}
                        hostName={party.hostName || ''}
                        initialCoHosts={party.coHosts || []}
                        onCoHostsChange={(coHosts) => setCoHostCount(coHosts.length)}
                      />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* Host Resources */}
      <HostResources />
    </div>
  );
};
