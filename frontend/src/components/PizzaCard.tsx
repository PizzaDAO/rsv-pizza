import React from 'react';
import { PizzaRecommendation } from '../types';
import { Users } from 'lucide-react';
import { getToppingEmoji } from '../utils/toppingEmojis';

interface PizzaCardProps {
  pizza: PizzaRecommendation;
  index: number;
  compact?: boolean;
}

export const PizzaCard: React.FC<PizzaCardProps> = ({ pizza, index, compact = false }) => {
  // Colors for different topping types
  const typeColors: Record<string, string> = {
    meat: 'bg-red-500/20 text-red-300',
    vegetable: 'bg-green-500/20 text-green-300',
    cheese: 'bg-yellow-500/20 text-yellow-300',
    fruit: 'bg-purple-500/20 text-purple-300',
  };

  const quantity = pizza.quantity || 1;
  const displayTitle = pizza.label
    ? `${quantity > 1 ? `${quantity}x ` : ''}${pizza.label}`
    : `${quantity > 1 ? `${quantity}x ` : ''}Pizza #${index + 1}`;

  // Compact version for order summary (3-column grid)
  if (compact) {
    // Half-and-half compact display
    if (pizza.isHalfAndHalf && pizza.leftHalf && pizza.rightHalf) {
      const leftEmojis = pizza.leftHalf.toppings.map(t => getToppingEmoji(t.name)).join('');
      const rightEmojis = pizza.rightHalf.toppings.map(t => getToppingEmoji(t.name)).join('');
      const guestNames = pizza.guests.map(g => g.name.split(' ')[0]);

      return (
        <div className="p-2.5 rounded-lg bg-gradient-to-r from-white/5 to-white/10 border border-white/10">
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <div className="w-7 h-7 rounded flex items-center justify-center text-[10px] font-bold bg-[#ff393a] text-white">
              ½+½
            </div>
            <span className="text-sm" title={`${pizza.leftHalf.toppings.map(t => t.name).join(', ')} / ${pizza.rightHalf.toppings.map(t => t.name).join(', ')}`}>
              {leftEmojis || '🧀'}|{rightEmojis || '🧀'}
            </span>
          </div>
          <div className="text-white text-[10px] font-medium leading-tight line-clamp-2 mb-1.5">
            <span>{pizza.leftHalf.toppings.map(t => t.name).join(', ') || 'Cheese'}</span>
            <span className="text-white/40 mx-1">/</span>
            <span>{pizza.rightHalf.toppings.map(t => t.name).join(', ') || 'Cheese'}</span>
          </div>
          {pizza.dietaryRestrictions.length > 0 && (
            <div className="flex flex-wrap gap-0.5 mb-1.5">
              {pizza.dietaryRestrictions.map(r => (
                <span key={r} className="text-[9px] text-purple-300 bg-purple-500/20 px-1 rounded">
                  {r}
                </span>
              ))}
            </div>
          )}
          {guestNames.length > 0 && (
            <div className="text-[10px] text-blue-300/80 leading-tight">
              {guestNames.slice(0, 3).join(', ')}
              {guestNames.length > 3 && ` +${guestNames.length - 3}`}
            </div>
          )}
        </div>
      );
    }

    const toppingEmojisDisplay = pizza.toppings.map(t => getToppingEmoji(t.name)).join('');
    const guestNames = pizza.guests.map(g => g.name.split(' ')[0]); // First names only

    return (
      <div className={`p-2.5 rounded-lg ${pizza.isForNonRespondents ? 'bg-[#6b7280]/20' : 'bg-white/5'} border border-white/10`}>
        <div className="flex items-center justify-between gap-1 mb-1.5">
          <div className={`w-7 h-7 rounded flex items-center justify-center text-sm font-bold ${pizza.isForNonRespondents ? 'bg-[#6b7280]' : 'bg-[#ff393a]'} text-white`}>
            {quantity}
          </div>
          <span className="text-base" title={pizza.toppings.map(t => t.name).join(', ')}>
            {toppingEmojisDisplay || '🧀'}
          </span>
        </div>
        <div className="text-white text-xs font-medium leading-tight line-clamp-2 mb-1.5">
          {pizza.label || pizza.toppings.map(t => t.name).join(', ') || 'Cheese'}
        </div>
        {pizza.dietaryRestrictions.length > 0 && (
          <div className="flex flex-wrap gap-0.5 mb-1.5">
            {pizza.dietaryRestrictions.map(r => (
              <span key={r} className="text-[9px] text-purple-300 bg-purple-500/20 px-1 rounded">
                {r}
              </span>
            ))}
          </div>
        )}
        {!pizza.isForNonRespondents && guestNames.length > 0 && (
          <div className="text-[10px] text-blue-300/80 leading-tight">
            {guestNames.slice(0, 3).join(', ')}
            {guestNames.length > 3 && ` +${guestNames.length - 3}`}
          </div>
        )}
        {pizza.isForNonRespondents && (
          <div className="text-[10px] text-white/40 italic">
            For non-RSVPs
          </div>
        )}
      </div>
    );
  }

  // Full version - half-and-half
  if (pizza.isHalfAndHalf && pizza.leftHalf && pizza.rightHalf) {
    return (
      <div className="border border-white/10 rounded-lg overflow-hidden bg-white/5 hover:bg-white/[0.07] transition-all">
        <div className="py-2 px-3 bg-gradient-to-r from-[#ff393a] via-[#ff6b35] to-[#ff393a]">
          <div className="flex justify-between items-center">
            <h3 className="text-white font-bold text-sm">
              <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] mr-2">½+½</span>
              Pizza #{index + 1}
            </h3>
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
          {/* Two halves side by side */}
          <div className="grid grid-cols-2 gap-2">
            {/* Left half */}
            <div className="p-2 bg-white/5 rounded-lg border-l-2 border-[#ff393a]">
              <div className="text-[9px] text-white/50 uppercase mb-1">Left Half</div>
              <div className="flex flex-wrap gap-1 mb-2">
                {pizza.leftHalf.toppings.map(topping => (
                  <span
                    key={topping.id}
                    className={`px-1 py-0.5 rounded text-[9px] font-medium ${typeColors[topping.type] || 'bg-white/10 text-white/70'}`}
                  >
                    {getToppingEmoji(topping.name)} {topping.name}
                  </span>
                ))}
                {pizza.leftHalf.toppings.length === 0 && (
                  <span className="text-[9px] text-white/50">Cheese</span>
                )}
              </div>
              {pizza.leftHalf.guests.length > 0 && (
                <div className="flex flex-wrap gap-0.5">
                  {pizza.leftHalf.guests.map(guest => (
                    <span key={guest.id || guest.name} className="px-1 py-0.5 bg-blue-500/15 text-blue-300 text-[9px] rounded">
                      {guest.name.split(' ')[0]}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Right half */}
            <div className="p-2 bg-white/5 rounded-lg border-r-2 border-[#ff6b35]">
              <div className="text-[9px] text-white/50 uppercase mb-1">Right Half</div>
              <div className="flex flex-wrap gap-1 mb-2">
                {pizza.rightHalf.toppings.map(topping => (
                  <span
                    key={topping.id}
                    className={`px-1 py-0.5 rounded text-[9px] font-medium ${typeColors[topping.type] || 'bg-white/10 text-white/70'}`}
                  >
                    {getToppingEmoji(topping.name)} {topping.name}
                  </span>
                ))}
                {pizza.rightHalf.toppings.length === 0 && (
                  <span className="text-[9px] text-white/50">Cheese</span>
                )}
              </div>
              {pizza.rightHalf.guests.length > 0 && (
                <div className="flex flex-wrap gap-0.5">
                  {pizza.rightHalf.guests.map(guest => (
                    <span key={guest.id || guest.name} className="px-1 py-0.5 bg-blue-500/15 text-blue-300 text-[9px] rounded">
                      {guest.name.split(' ')[0]}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {pizza.dietaryRestrictions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-white/10">
              {pizza.dietaryRestrictions.map(restriction => (
                <span key={restriction} className="px-1.5 py-0.5 bg-purple-500/20 text-purple-300 text-[10px] rounded border border-purple-500/30">
                  {restriction}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Full version - regular pizza
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
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${typeColors[topping.type] || 'bg-white/10 text-white/70'}`}
            >
              {getToppingEmoji(topping.name)} {topping.name}
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
