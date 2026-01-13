import React from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { Guest } from '../types';
import { Trash2 } from 'lucide-react';
import { getToppingEmoji } from '../utils/toppingEmojis';

interface GuestCardProps {
  guest: Guest;
}

export const GuestCard: React.FC<GuestCardProps> = ({ guest }) => {
  const { removeGuest, availableToppings, availableBeverages } = usePizza();

  const toppingNameById = (id: string) => {
    return availableToppings.find(t => t.id === id)?.name || id;
  };

  const beverageNameById = (id: string) => {
    return availableBeverages.find(b => b.id === id)?.name || id;
  };

  return (
    <div className="border border-white/10 rounded-lg p-3 bg-white/5 hover:bg-white/[0.07] hover:border-white/15 transition-all group">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white text-sm">{guest.name}</span>
            {guest.dietaryRestrictions.map(restriction => (
              <span key={restriction} className="px-1.5 py-0.5 bg-purple-500/20 text-purple-300 text-[10px] rounded border border-purple-500/30">
                {restriction}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {guest.toppings.map(toppingId => {
              const name = toppingNameById(toppingId);
              return (
                <span key={toppingId} className="px-1.5 py-0.5 bg-[#39d98a]/20 text-[#39d98a] text-[10px] rounded">
                  {getToppingEmoji(name)} {name}
                </span>
              );
            })}
            {guest.dislikedToppings.map(toppingId => {
              const name = toppingNameById(toppingId);
              return (
                <span key={toppingId} className="px-1.5 py-0.5 bg-[#ff393a]/20 text-[#ff393a] text-[10px] rounded line-through">
                  {getToppingEmoji(name)} {name}
                </span>
              );
            })}
          </div>
          {/* Beverage Preferences */}
          {((guest.likedBeverages && guest.likedBeverages.length > 0) ||
            (guest.dislikedBeverages && guest.dislikedBeverages.length > 0)) && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {guest.likedBeverages?.map(beverageId => {
                const name = beverageNameById(beverageId);
                return (
                  <span key={beverageId} className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] rounded">
                    {name}
                  </span>
                );
              })}
              {guest.dislikedBeverages?.map(beverageId => {
                const name = beverageNameById(beverageId);
                return (
                  <span key={beverageId} className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] rounded line-through">
                    {name}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <button
          onClick={() => guest.id && removeGuest(guest.id)}
          className="p-1 text-white/30 hover:text-[#ff393a] hover:bg-[#ff393a]/10 rounded transition-colors opacity-0 group-hover:opacity-100"
          aria-label="Remove guest"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};
