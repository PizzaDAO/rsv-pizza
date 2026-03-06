import React, { useState, useMemo, useEffect } from 'react';
import { X, Star, Search, Loader2 } from 'lucide-react';
import { Guest } from '../../types';
import { IconInput } from '../IconInput';
import { ClickableEmail } from '../ClickableEmail';
import { addNotableAttendee, deleteNotableAttendeeByGuestId, getNotableGuestIds } from '../../lib/api';

interface BrowseGuestsModalProps {
  isOpen: boolean;
  onClose: () => void;
  guests: Guest[];
  partyId: string;
  onChanged: () => void; // callback to refresh notable attendees list
}

export function BrowseGuestsModal({ isOpen, onClose, guests, partyId, onChanged }: BrowseGuestsModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [notableGuestIds, setNotableGuestIds] = useState<Set<string>>(new Set());
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch notable guest IDs when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    getNotableGuestIds(partyId).then(ids => {
      setNotableGuestIds(new Set(ids));
      setLoading(false);
    });
  }, [isOpen, partyId]);

  const filteredGuests = useMemo(() => {
    if (!searchQuery.trim()) return guests;
    const q = searchQuery.toLowerCase().trim();
    return guests.filter(g =>
      g.name.toLowerCase().includes(q) ||
      (g.email && g.email.toLowerCase().includes(q))
    );
  }, [guests, searchQuery]);

  const handleToggle = async (guest: Guest) => {
    if (!guest.id || togglingId) return;

    const guestId = guest.id;
    const isCurrentlyNotable = notableGuestIds.has(guestId);
    setTogglingId(guestId);

    // Optimistic update
    setNotableGuestIds(prev => {
      const next = new Set(prev);
      if (isCurrentlyNotable) {
        next.delete(guestId);
      } else {
        next.add(guestId);
      }
      return next;
    });

    try {
      if (isCurrentlyNotable) {
        const success = await deleteNotableAttendeeByGuestId(partyId, guestId);
        if (!success) {
          // Revert on failure
          setNotableGuestIds(prev => {
            const next = new Set(prev);
            next.add(guestId);
            return next;
          });
        }
      } else {
        const result = await addNotableAttendee(partyId, { name: guest.name, guestId });
        if (!result) {
          // Revert on failure
          setNotableGuestIds(prev => {
            const next = new Set(prev);
            next.delete(guestId);
            return next;
          });
        }
      }
      onChanged();
    } catch {
      // Revert on error
      setNotableGuestIds(prev => {
        const next = new Set(prev);
        if (isCurrentlyNotable) {
          next.add(guestId);
        } else {
          next.delete(guestId);
        }
        return next;
      });
    } finally {
      setTogglingId(null);
    }
  };

  const notableCount = notableGuestIds.size;

  if (!isOpen) return null;

  // Generate a consistent color based on name (same logic as TableRow)
  const getAvatarColor = (name: string) => {
    const colors = [
      'bg-red-400', 'bg-orange-400', 'bg-amber-400', 'bg-yellow-400',
      'bg-lime-400', 'bg-green-400', 'bg-emerald-400', 'bg-teal-400',
      'bg-cyan-400', 'bg-sky-400', 'bg-blue-400', 'bg-indigo-400',
      'bg-violet-400', 'bg-purple-400', 'bg-fuchsia-400', 'bg-pink-400',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#1a1a2e] rounded-2xl border border-white/10 w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Browse All Guests</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-4">
          <IconInput
            icon={Search}
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Guest list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-white/40" />
            </div>
          ) : filteredGuests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search size={36} className="text-white/20 mb-3" />
              <p className="text-white/50 text-sm">
                {searchQuery.trim() ? `No guests match "${searchQuery}"` : 'No guests yet'}
              </p>
            </div>
          ) : (
            filteredGuests.map(guest => {
              const guestId = guest.id || '';
              const isNotable = notableGuestIds.has(guestId);
              const isToggling = togglingId === guestId;

              return (
                <div
                  key={guestId}
                  className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg hover:bg-white/5 transition-colors"
                >
                  {/* Avatar */}
                  <div className={`w-8 h-8 rounded-full ${getAvatarColor(guest.name)} flex items-center justify-center text-white text-sm font-medium flex-shrink-0`}>
                    {guest.name.charAt(0).toUpperCase()}
                  </div>

                  {/* Name & email */}
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-white text-sm">{guest.name}</span>
                    {guest.email && (
                      <span className="text-white/40 text-xs ml-2">
                        <ClickableEmail email={guest.email} className="text-white/40 text-xs" />
                      </span>
                    )}
                  </div>

                  {/* Star toggle */}
                  <button
                    onClick={() => handleToggle(guest)}
                    disabled={isToggling}
                    className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${
                      isNotable
                        ? 'text-yellow-400 hover:bg-yellow-400/10'
                        : 'text-white/20 hover:text-yellow-400 hover:bg-yellow-400/10'
                    }`}
                    title={isNotable ? 'Remove from notable attendees' : 'Mark as notable attendee'}
                  >
                    {isToggling ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <Star size={18} fill={isNotable ? 'currentColor' : 'none'} />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer counter */}
        <div className="px-4 py-3 border-t border-white/10 text-center">
          <span className="text-sm text-white/50">
            {notableCount} notable {notableCount === 1 ? 'attendee' : 'attendees'} selected
          </span>
        </div>
      </div>
    </div>
  );
}
