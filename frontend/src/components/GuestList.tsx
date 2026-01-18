import React from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { TableRow } from './TableRow';
import { UserRoundX } from 'lucide-react';

export const GuestList: React.FC = () => {
  const { guests, removeGuest, approveGuest, declineGuest, party } = usePizza();

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

      <div className="divide-y divide-white/10">
        {guests.map(guest => (
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
    </div>
  );
};
