import React, { useState, useMemo } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { TableRow } from './TableRow';
import { UserRoundX, Users, Clock, Search, CheckCircle2, Download } from 'lucide-react';
import { IconInput } from './IconInput';
import { checkInGuest } from '../lib/api';

export const GuestList: React.FC = () => {
  const { guests, removeGuest, approveGuest, declineGuest, promoteGuest, party, loadParty } = usePizza();
  const [searchQuery, setSearchQuery] = useState('');
  const [checkingInId, setCheckingInId] = useState<string | null>(null);

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
        <UserRoundX size={48} className="text-white/30 mb-4" />
        <h3 className="text-xl font-medium text-white/80">No Guests Yet</h3>
        <p className="text-white/50 mt-2">
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
            <Users size={20} className="text-white/60" />
            <h2 className="text-xl font-bold text-white">Guests</h2>
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
            className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors"
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
          <p className="text-sm text-white/50 mb-3">
            Showing {filteredGuests.length} of {guests.length} guests
          </p>
        )}

        {confirmedGuests.length === 0 ? (
          searchQuery.trim() ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Search size={36} className="text-white/20 mb-3" />
              <p className="text-white/50">No guests match "{searchQuery}"</p>
            </div>
          ) : (
            <p className="text-white/50 text-sm py-4">No confirmed guests yet.</p>
          )
        ) : (
          <div className="divide-y divide-white/10">
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
              <Clock size={20} className="text-white/60" />
              <h2 className="text-xl font-bold text-white">Waitlist</h2>
              <span className="bg-[#ffc107]/20 text-[#ffc107] text-sm font-medium px-3 py-1 rounded-full border border-[#ffc107]/30">
                {waitlistedGuests.length}
              </span>
            </div>
          </div>

          <div className="divide-y divide-white/10">
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
