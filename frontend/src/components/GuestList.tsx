import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { TableRow } from './TableRow';
import { UserRoundX, Users, Clock, Search, CheckCircle2, Download } from 'lucide-react';
import { IconInput } from './IconInput';
import { checkInGuest, getNotableGuestIds, addNotableAttendee, deleteNotableAttendeeByGuestId } from '../lib/api';

export const GuestList: React.FC = () => {
  const { guests, removeGuest, approveGuest, declineGuest, promoteGuest, party, loadParty } = usePizza();
  const [searchQuery, setSearchQuery] = useState('');
  const [checkingInId, setCheckingInId] = useState<string | null>(null);
  const [notableGuestIds, setNotableGuestIds] = useState<Set<string>>(new Set());
  const [togglingNotableId, setTogglingNotableId] = useState<string | null>(null);

  // Fetch notable guest IDs on mount and when party changes
  const fetchNotableIds = useCallback(async () => {
    if (!party?.id) return;
    try {
      const ids = await getNotableGuestIds(party.id);
      setNotableGuestIds(new Set(ids));
    } catch {
      // Silently fail - non-critical feature
    }
  }, [party?.id]);

  useEffect(() => {
    fetchNotableIds();
  }, [fetchNotableIds]);

  const handleToggleNotable = async (guestId: string) => {
    if (!party?.id || togglingNotableId) return;

    const isCurrentlyNotable = notableGuestIds.has(guestId);
    setTogglingNotableId(guestId);

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
        const success = await deleteNotableAttendeeByGuestId(party.id, guestId);
        if (!success) {
          // Revert
          setNotableGuestIds(prev => { const next = new Set(prev); next.add(guestId); return next; });
        }
      } else {
        const guest = guests.find(g => g.id === guestId);
        if (guest) {
          const result = await addNotableAttendee(party.id, { name: guest.name, guestId });
          if (!result) {
            // Revert
            setNotableGuestIds(prev => { const next = new Set(prev); next.delete(guestId); return next; });
          }
        }
      }
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
      setTogglingNotableId(null);
    }
  };

  const filteredGuests = useMemo(() => {
    if (!searchQuery.trim()) return guests;
    const query = searchQuery.toLowerCase().trim();
    return guests.filter(guest =>
      guest.name.toLowerCase().includes(query) ||
      (guest.email && guest.email.toLowerCase().includes(query))
    );
  }, [guests, searchQuery]);

  if (guests.length === 0) {
    return (
      <div className="card p-6 flex flex-col items-center justify-center min-h-[200px] text-center">
        <UserRoundX size={48} className="text-theme-text-faint mb-4" />
        <h3 className="text-xl font-medium text-theme-text">No Guests Yet</h3>
        <p className="text-theme-text-muted mt-2">
          Share your event link to start receiving RSVPs.
        </p>
      </div>
    );
  }

  const requireApproval = party?.requireApproval || false;

  const exportCSV = () => {
    const headers = ['Name', 'Email', 'RSVP Date', 'Dietary Restrictions', 'Liked Toppings', 'Disliked Toppings', 'Wallet Address'];
    const rows = guests.map(g => [
      g.name,
      g.email || '',
      g.submittedAt ? new Date(g.submittedAt).toLocaleDateString() : '',
      g.dietaryRestrictions.join('; '),
      g.toppings.join('; '),
      g.dislikedToppings.join('; '),
      g.ethereumAddress || '',
    ]);
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${party?.name || 'guests'}-guests.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Count checked-in guests
  const checkedInCount = guests.filter(g => g.checkedInAt).length;

  // Handle manual check-in
  const handleCheckIn = async (guestId: string) => {
    if (!party?.inviteCode || !guestId) return;

    setCheckingInId(guestId);
    try {
      await checkInGuest(party.inviteCode, guestId);
      // Reload party data to get updated check-in status
      await loadParty(party.inviteCode);
    } catch (error) {
      console.error('Failed to check in guest:', error);
    } finally {
      setCheckingInId(null);
    }
  };

  // Separate guests by status
  const confirmedGuests = filteredGuests.filter(g => g.status !== 'WAITLISTED');
  const waitlistedGuests = filteredGuests.filter(g => g.status === 'WAITLISTED')
    .sort((a, b) => (a.waitlistPosition || 0) - (b.waitlistPosition || 0));

  return (
    <div className="space-y-6">
      {/* Confirmed Guests Section */}
      <div className="card p-6">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <Users size={20} className="text-theme-text-secondary" />
            <h2 className="text-xl font-bold text-theme-text">Guests</h2>
            <span className="bg-[#39d98a]/20 text-[#39d98a] text-sm font-medium px-3 py-1 rounded-full border border-[#39d98a]/30">
              {confirmedGuests.length}
              {party?.maxGuests && ` / ${party.maxGuests}`}
            </span>
            {checkedInCount > 0 && (
              <span className="bg-green-500/20 text-green-400 text-sm font-medium px-3 py-1 rounded-full border border-green-500/30 flex items-center gap-1">
                <CheckCircle2 size={14} />
                {checkedInCount} checked in
              </span>
            )}
          </div>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 text-xs text-theme-text-muted hover:text-theme-text transition-colors"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>

        <div className="mb-4">
          <IconInput
            icon={Search}
            type="text"
            placeholder="Search guests by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {searchQuery.trim() && (
          <p className="text-sm text-theme-text-muted mb-3">
            Showing {filteredGuests.length} of {guests.length} guests
          </p>
        )}

        {confirmedGuests.length === 0 ? (
          searchQuery.trim() ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Search size={36} className="text-theme-text-faint mb-3" />
              <p className="text-theme-text-muted">No guests match "{searchQuery}"</p>
            </div>
          ) : (
            <p className="text-theme-text-muted text-sm py-4">No confirmed guests yet.</p>
          )
        ) : (
          <div className="divide-y divide-theme-stroke">
            {confirmedGuests.map(guest => (
              <TableRow
                key={guest.id}
                guest={guest}
                variant="basic"
                requireApproval={requireApproval}
                onApprove={approveGuest}
                onDecline={declineGuest}
                onRemove={removeGuest}
                onCheckIn={handleCheckIn}
                isCheckingIn={checkingInId === guest.id}
                isNotable={guest.id ? notableGuestIds.has(guest.id) : false}
                onToggleNotable={handleToggleNotable}
                isTogglingNotable={togglingNotableId === guest.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Waitlist Section */}
      {waitlistedGuests.length > 0 && (
        <div className="card p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              <Clock size={20} className="text-theme-text-secondary" />
              <h2 className="text-xl font-bold text-theme-text">Waitlist</h2>
              <span className="bg-[#ffc107]/20 text-[#ffc107] text-sm font-medium px-3 py-1 rounded-full border border-[#ffc107]/30">
                {waitlistedGuests.length}
              </span>
            </div>
          </div>

          <div className="divide-y divide-theme-stroke">
            {waitlistedGuests.map(guest => (
              <TableRow
                key={guest.id}
                guest={guest}
                variant="waitlist"
                onPromote={promoteGuest}
                onRemove={removeGuest}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
