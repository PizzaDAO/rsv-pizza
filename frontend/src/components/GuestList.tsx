import React from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { TableRow } from './TableRow';
import { UserRoundX, Users, Clock } from 'lucide-react';

export const GuestList: React.FC = () => {
  const { guests, removeGuest, approveGuest, declineGuest, promoteGuest, party } = usePizza();

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

  // Separate guests by status
  const confirmedGuests = guests.filter(g => g.status !== 'WAITLISTED');
  const waitlistedGuests = guests.filter(g => g.status === 'WAITLISTED')
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
          </div>
        </div>

        {confirmedGuests.length === 0 ? (
          <p className="text-white/50 text-sm py-4">No confirmed guests yet.</p>
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
