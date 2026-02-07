import React, { useState, useMemo } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { TableRow } from './TableRow';
import { UserRoundX, Search } from 'lucide-react';
import { IconInput } from './IconInput';

export const GuestList: React.FC = () => {
  const { guests, removeGuest, approveGuest, declineGuest, party } = usePizza();
  const [searchQuery, setSearchQuery] = useState('');

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

  return (
    <div className="card p-6">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">Guests</h2>
          <span className="bg-[#ff393a]/20 text-[#ff393a] text-sm font-medium px-3 py-1 rounded-full border border-[#ff393a]/30">
            {guests.length}
          </span>
        </div>
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

      {filteredGuests.length === 0 && searchQuery.trim() ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Search size={36} className="text-white/20 mb-3" />
          <p className="text-white/50">No guests match "{searchQuery}"</p>
        </div>
      ) : (
        <div className="divide-y divide-white/10">
          {filteredGuests.map(guest => (
            <TableRow
              key={guest.id}
              guest={guest}
              variant="basic"
              requireApproval={requireApproval}
              onApprove={approveGuest}
              onDecline={declineGuest}
              onRemove={removeGuest}
            />
          ))}
        </div>
      )}
    </div>
  );
};
