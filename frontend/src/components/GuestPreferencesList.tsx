import React from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { GuestCard } from './GuestCard';
import { UserRoundX } from 'lucide-react';

export const GuestPreferencesList: React.FC = () => {
  const { guests } = usePizza();

  if (guests.length === 0) {
    return (
      <div className="card p-6 flex flex-col items-center justify-center min-h-[200px] text-center">
        <UserRoundX size={48} className="text-white/30 mb-4" />
        <h3 className="text-xl font-medium text-white/80">No Guest Requests Yet</h3>
        <p className="text-white/50 mt-2">
          Guest requests will appear here once they RSVP.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-white">Guest Requests</h2>
        <span className="bg-[#ff393a]/20 text-[#ff393a] text-sm font-medium px-3 py-1 rounded-full border border-[#ff393a]/30">
          {guests.length} {guests.length === 1 ? 'Guest' : 'Guests'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {guests.map(guest => (
          <GuestCard key={guest.id} guest={guest} />
        ))}
      </div>
    </div>
  );
};
