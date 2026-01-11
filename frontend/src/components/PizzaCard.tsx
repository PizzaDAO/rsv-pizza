import React from 'react';
import { PizzaRecommendation } from '../types';
import { Users } from 'lucide-react';

interface PizzaCardProps {
  pizza: PizzaRecommendation;
  index: number;
  compact?: boolean;
}

export const PizzaCard: React.FC<PizzaCardProps> = ({ pizza, index, compact = false }) => {
  // Colors for different topping categories
  const categoryColors: Record<string, string> = {
    meat: 'bg-red-500/20 text-red-300',
    vegetable: 'bg-green-500/20 text-green-300',
    cheese: 'bg-yellow-500/20 text-yellow-300',
    fruit: 'bg-purple-500/20 text-purple-300',
  };

  const quantity = pizza.quantity || 1;
  const displayTitle = pizza.label
    ? `${quantity > 1 ? `${quantity}x ` : ''}${pizza.label}`
    : `${quantity > 1 ? `${quantity}x ` : ''}Pizza #${index + 1}`;

  // Compact version for order summary
  if (compact) {
    return (
      <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg ${pizza.isForNonRespondents ? 'bg-[#6b7280]/20' : 'bg-white/5'} border border-white/10`}>
        <div className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold ${pizza.isForNonRespondents ? 'bg-[#6b7280]' : 'bg-[#ff393a]'} text-white`}>
          {quantity}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-white text-xs font-medium truncate">
              {pizza.label || pizza.toppings.map(t => t.name).join(', ') || 'Cheese'}
            </span>
            <span className="text-white/40 text-[10px] flex-shrink-0">
              {pizza.size.diameter}"
            </span>
          </div>
          {pizza.dietaryRestrictions.length > 0 && (
            <div className="flex gap-1 mt-0.5">
              {pizza.dietaryRestrictions.map(r => (
                <span key={r} className="text-[9px] text-purple-300 bg-purple-500/20 px-1 rounded">
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5 text-white/50 text-[10px] flex-shrink-0">
          <Users size={10} />
          <span>{pizza.guestCount}</span>
        </div>
      </div>
    );
  }

  // Full version
  return (
    <div className="border border-white/10 rounded-lg overflow-hidden bg-white/5 hover:bg-white/[0.07] transition-all">
      <div className={`py-2 px-3 ${pizza.isForNonRespondents ? 'bg-gradient-to-r from-[#6b7280] to-[#9ca3af]' : 'bg-gradient-to-r from-[#ff393a] to-[#ff6b35]'}`}>
        <div className="flex justify-between items-center">
          <h3 className="text-white font-bold text-sm">{displayTitle}</h3>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-white/80">
              {pizza.size.diameter}" {pizza.style.name}
            </span>
            <div className="flex items-center gap-0.5 bg-white/20 rounded-full px-1.5 py-0.5">
              <Users size={10} className="text-white" />
              <span className="text-white">{pizza.guestCount}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-2.5">
        <div className="flex flex-wrap gap-1">
          {pizza.toppings.map(topping => (
            <span
              key={topping.id}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${categoryColors[topping.category] || 'bg-white/10 text-white/70'}`}
            >
              {topping.name}
            </span>
          ))}
          {pizza.dietaryRestrictions.map(restriction => (
            <span key={restriction} className="px-1.5 py-0.5 bg-purple-500/20 text-purple-300 text-[10px] rounded border border-purple-500/30">
              {restriction}
            </span>
          ))}
        </div>

        {!pizza.isForNonRespondents && pizza.guests.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-white/10">
            {pizza.guests.slice(0, 4).map(guest => (
              <span key={guest.id} className="px-1.5 py-0.5 bg-blue-500/15 text-blue-300 text-[10px] rounded">
                {guest.name}
              </span>
            ))}
            {pizza.guests.length > 4 && (
              <span className="px-1.5 py-0.5 text-white/40 text-[10px]">
                +{pizza.guests.length - 4}
              </span>
            )}
          </div>
        )}

        {pizza.isForNonRespondents && (
          <div className="mt-2 pt-2 border-t border-white/10">
            <span className="text-white/40 text-[10px] italic">
              For {pizza.guestCount} who didn't RSVP
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
