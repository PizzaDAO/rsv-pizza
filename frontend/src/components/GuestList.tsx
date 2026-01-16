import React from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { GuestBasicCard } from './GuestBasicCard';
import { UserRoundX, UserPlus } from 'lucide-react';

interface GuestListProps {
  onInviteClick: () => void;
}

export const GuestList: React.FC<GuestListProps> = ({ onInviteClick }) => {
  const { guests } = usePizza();

  if (guests.length === 0) {
    return (
      <div className="card p-6 flex flex-col items-center justify-center min-h-[200px] text-center">
        <UserRoundX size={48} className="text-white/30 mb-4" />
        <h3 className="text-xl font-medium text-white/80">No Guests Added Yet</h3>
        <p className="text-white/50 mt-2 mb-4">
          Start inviting guests to your party.
        </p>
        <button
          onClick={onInviteClick}
          className="btn-primary flex items-center gap-2"
        >
          <UserPlus size={18} />
          <span>Invite Guest</span>
        </button>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">Guests</h2>
          <span className="bg-[#ff393a]/20 text-[#ff393a] text-sm font-medium px-3 py-1 rounded-full border border-[#ff393a]/30">
            {guests.length}
          </span>
        </div>
        <button
          onClick={onInviteClick}
          className="btn-primary flex items-center gap-2"
        >
          <UserPlus size={18} />
          <span>Invite Guest</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {guests.map(guest => (
          <GuestBasicCard key={guest.id} guest={guest} />
        ))}
      </div>
    </div>
  );
};
