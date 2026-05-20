import React, { useMemo, useState } from 'react';
import { Search, UserCheck, UserPlus, Check, Loader2 } from 'lucide-react';
import { Party, Guest } from '../../types';
import { IconInput } from '../IconInput';
import { checkInGuest, uncheckInGuestApi } from '../../lib/api';
import { WalkInModal } from './WalkInModal';

interface CheckInPanelProps {
  party: Party;
  guests: Guest[];
  onGuestUpdated?: () => void;
}

/**
 * Searchable, one-tap check-in panel. Sorts uncheckedin guests above
 * checked-in. "Walk-in" button at top opens WalkInModal.
 */
export const CheckInPanel: React.FC<CheckInPanelProps> = ({ party, guests, onGuestUpdated }) => {
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showWalkIn, setShowWalkIn] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const eligible = guests.filter((g) => g.approved !== false && g.status !== 'WAITLISTED');
    const matched = q
      ? eligible.filter(
          (g) =>
            (g.name || '').toLowerCase().includes(q) ||
            (g.email || '').toLowerCase().includes(q)
        )
      : eligible;
    // Unchecked first, then alpha
    return [...matched].sort((a, b) => {
      const aChecked = !!a.checkedInAt;
      const bChecked = !!b.checkedInAt;
      if (aChecked !== bChecked) return aChecked ? 1 : -1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [guests, query]);

  const toggleCheckIn = async (guest: Guest) => {
    setBusyId(guest.id);
    try {
      if (guest.checkedInAt) {
        await uncheckInGuestApi(party.inviteCode, guest.id);
      } else {
        await checkInGuest(party.inviteCode, guest.id);
      }
      onGuestUpdated?.();
    } catch (err) {
      console.error('[CheckInPanel] check-in toggle failed:', err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UserCheck size={18} className="text-[#ff393a]" />
          <h3 className="text-lg font-semibold text-theme-text">Check-in</h3>
        </div>
        <button
          type="button"
          onClick={() => setShowWalkIn(true)}
          className="inline-flex items-center gap-1.5 text-sm bg-[#ff393a] text-white px-3 py-1.5 rounded-lg font-medium hover:opacity-90"
        >
          <UserPlus size={14} />
          Walk-in
        </button>
      </div>

      <IconInput
        icon={Search}
        placeholder="Search by name or email"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="max-h-[28rem] overflow-y-auto -mx-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-theme-text-muted italic px-2 py-4">
            {query ? 'No matches.' : 'No guests yet.'}
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((g) => {
              const checkedIn = !!g.checkedInAt;
              const busy = busyId === g.id;
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => toggleCheckIn(g)}
                    disabled={busy}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      checkedIn
                        ? 'bg-green-500/10 hover:bg-green-500/15'
                        : 'hover:bg-white/5'
                    } ${busy ? 'opacity-50' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm truncate ${
                          checkedIn ? 'text-theme-text-muted line-through' : 'text-theme-text font-medium'
                        }`}
                      >
                        {g.name || 'Anonymous'}
                      </p>
                      {g.email && (
                        <p className="text-xs text-theme-text-muted truncate">{g.email}</p>
                      )}
                    </div>
                    {busy ? (
                      <Loader2 size={16} className="animate-spin text-theme-text-muted" />
                    ) : checkedIn ? (
                      <Check size={18} className="text-green-500 flex-shrink-0" />
                    ) : (
                      <span className="text-xs text-[#ff393a] font-semibold whitespace-nowrap">
                        Tap to check in
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showWalkIn && (
        <WalkInModal
          partyId={party.id}
          onClose={() => setShowWalkIn(false)}
          onAdded={() => onGuestUpdated?.()}
        />
      )}
    </div>
  );
};
