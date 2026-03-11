import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PartyPopper, Package, Users, MapPin, DollarSign, Handshake, ClipboardCheck, Megaphone, Rocket, CheckCircle, Circle, Loader2 } from 'lucide-react';
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
      },
      {
        label: 'Request Party Kit',
        done: autoStates?.party_kit_submitted ?? false,
        tab: 'gpp',
        icon: Package,
      },
      {
        label: 'Build a Team',
        done: coHostCount > 0,
        tab: null,
        onClick: () => setHostsExpanded(prev => !prev),
        icon: Users,
      },
      {
        label: 'Find a Venue',
        done: autoStates?.venue_added ?? !!party.venueName,
        tab: 'venue',
        icon: MapPin,
      },
      {
        label: 'Set Up Budget',
        done: autoStates?.budget_submitted ?? false,
        tab: 'budget',
        icon: DollarSign,
      },
      {
        label: 'Find Partners',
        done: false,
        tab: 'sponsors',
        icon: Handshake,
      },
      {
        label: 'Prepare for the Party',
        done: false,
        tab: null,
        icon: ClipboardCheck,
      },
      {
        label: 'Post to Socials',
        done: false,
        tab: 'promo',
        icon: Megaphone,
      },
      {
        label: 'Throw the Party',
        done: false,
        tab: null,
        icon: Rocket,
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
          <div className="text-2xl font-bold text-white">{guests.length}</div>
          <div className="text-xs text-white/50">RSVPs</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-white">
            {daysUntil !== null ? daysUntil : '—'}
          </div>
          <div className="text-xs text-white/50">Days Until Event</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-white">
            {guests.filter((g) => g.status === 'PENDING').length}
          </div>
          <div className="text-xs text-white/50">Pending Approval</div>
        </div>
      </div>

      {/* Checklist progress */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Event Setup</h3>
          <span className="text-sm text-white/50">
            {completedCount} of {totalCount} complete
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-white/10 rounded-full mb-6 overflow-hidden">
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
            <Loader2 className="w-5 h-5 animate-spin text-white/40" />
          </div>
        ) : (
          <div className="space-y-1">
            {checklist.map((item) => {
              const Icon = item.icon;
              const clickable = item.tab || item.onClick;
              const Wrapper = clickable ? 'button' : 'div';
              return (
                <React.Fragment key={item.label}>
                  <Wrapper
                    onClick={clickable ? (item.onClick || (() => goToTab(item.tab!))) : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left group ${
                      clickable ? 'hover:bg-white/5 cursor-pointer' : ''
                    }`}
                  >
                    {item.done ? (
                      <CheckCircle size={18} className="text-green-500 shrink-0" />
                    ) : (
                      <Circle size={18} className="text-white/20 shrink-0" />
                    )}
                    <Icon size={16} className={item.done ? 'text-white/40 shrink-0' : 'text-white/60 shrink-0'} />
                    <span
                      className={`text-sm ${
                        item.done ? 'text-white/40 line-through' : 'text-white'
                      }`}
                    >
                      {item.label}
                    </span>
                    {clickable && (
                      <span className="ml-auto text-xs text-white/20 group-hover:text-white/40 transition-colors">
                        {item.label === 'Build a Team' && hostsExpanded ? '\u25B2' : 'Go \u2192'}
                      </span>
                    )}
                  </Wrapper>
                  {item.label === 'Build a Team' && hostsExpanded && (
                    <div className="ml-9 mr-3 mb-2 mt-1 p-4 bg-white/5 rounded-xl border border-white/10 animate-fade-in">
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
