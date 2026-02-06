import React, { useState } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { TableRow } from './TableRow';
import { UserRoundX, CheckCircle2, Loader2 } from 'lucide-react';
import { checkInGuest } from '../lib/api';

export const GuestList: React.FC = () => {
  const { guests, removeGuest, approveGuest, declineGuest, party, loadParty } = usePizza();
  const [checkingInId, setCheckingInId] = useState<string | null>(null);

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

  return (
    <div className="card p-6">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">Guests</h2>
          <span className="bg-[#ff393a]/20 text-[#ff393a] text-sm font-medium px-3 py-1 rounded-full border border-[#ff393a]/30">
            {guests.length}
          </span>
          {checkedInCount > 0 && (
            <span className="bg-green-500/20 text-green-400 text-sm font-medium px-3 py-1 rounded-full border border-green-500/30 flex items-center gap-1">
              <CheckCircle2 size={14} />
              {checkedInCount} checked in
            </span>
          )}
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
            onCheckIn={handleCheckIn}
            isCheckingIn={checkingInId === guest.id}
          />
        ))}
      </div>
    </div>
  );
};
