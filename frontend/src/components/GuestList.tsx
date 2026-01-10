import React from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { GuestCard } from './GuestCard';
import { UserRoundX } from 'lucide-react';

export const GuestList: React.FC = () => {
  const { guests, generateRecommendations } = usePizza();

  if (guests.length === 0) {
    return (
      <div className="card p-6 flex flex-col items-center justify-center min-h-[200px] text-center">
        <UserRoundX size={48} className="text-white/30 mb-4" />
        <h3 className="text-xl font-medium text-white/80">No Guests Added Yet</h3>
        <p className="text-white/50 mt-2">
          Add your first guest by clicking the "Add Guest" button above.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-white">Guest Preferences</h2>
        <span className="bg-[#ff393a]/20 text-[#ff393a] text-sm font-medium px-3 py-1 rounded-full border border-[#ff393a]/30">
          {guests.length} {guests.length === 1 ? 'Guest' : 'Guests'}
        </span>
      </div>

      <div className="space-y-3 mb-6">
        {guests.map(guest => (
          <GuestCard key={guest.id} guest={guest} />
        ))}
      </div>

      <button
        onClick={generateRecommendations}
        disabled={guests.length === 0}
        className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Generate Pizza Recommendations
      </button>
    </div>
  );
};
