import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Calendar, MapPin, Image, Home, Package, DollarSign, CheckCircle, Circle, Loader2 } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { getChecklist } from '../../lib/api';
import { AutoCompleteStates } from '../../types';
import { HostResources } from './HostResources';

const DEFAULT_GPP_IMAGE = 'https://rsv.pizza/gpp-flyer-2026.png';

export const GPPDashboardTab: React.FC = () => {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { party, guests } = usePizza();
  const [autoStates, setAutoStates] = useState<AutoCompleteStates | null>(null);
  const [loading, setLoading] = useState(true);

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
        label: 'Set event date & time',
        done: !!party.date,
        tab: 'details',
        icon: Calendar,
      },
      {
        label: 'Set event location',
        done: !!party.address,
        tab: 'details',
        icon: MapPin,
      },
      {
        label: 'Upload event image',
        done: !!party.eventImageUrl && party.eventImageUrl !== DEFAULT_GPP_IMAGE,
        tab: 'details',
        icon: Image,
      },
      {
        label: 'Confirm venue',
        done: autoStates?.venue_added ?? !!party.venueName,
        tab: 'venue',
        icon: Home,
      },
      {
        label: 'Request party kit',
        done: autoStates?.party_kit_submitted ?? false,
        tab: 'gpp',
        icon: Package,
      },
      {
        label: 'Set up budget',
        done: autoStates?.budget_submitted ?? false,
        tab: 'budget',
        icon: DollarSign,
      },
    ];
  }, [party, autoStates]);

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
              return (
                <button
                  key={item.label}
                  onClick={() => goToTab(item.tab)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors text-left group"
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
                  <span className="ml-auto text-xs text-white/20 group-hover:text-white/40 transition-colors">
                    Go &rarr;
                  </span>
                </button>
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
