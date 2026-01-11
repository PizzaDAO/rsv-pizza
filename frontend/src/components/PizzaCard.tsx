import React from 'react';
import { PizzaRecommendation } from '../types';
import { Users } from 'lucide-react';

interface PizzaCardProps {
  pizza: PizzaRecommendation;
  index: number;
  compact?: boolean;
}

// Emoji mappings for toppings
const toppingEmojis: Record<string, string> = {
  // Meats
  'pepperoni': '🔴',
  'sausage': '🌭',
  'bacon': '🥓',
  'ham': '🍖',
  'chicken': '🍗',
  'beef': '🥩',
  'meatball': '🧆',
  'salami': '🔴',
  'prosciutto': '🥓',
  'anchovies': '🐟',
  // Vegetables
  'mushrooms': '🍄',
  'onions': '🧅',
  'peppers': '🫑',
  'bell peppers': '🫑',
  'green peppers': '🫑',
  'olives': '🫒',
  'black olives': '🫒',
  'tomatoes': '🍅',
  'spinach': '🥬',
  'basil': '🌿',
  'garlic': '🧄',
  'jalapeños': '🌶️',
  'jalapenos': '🌶️',
  'hot peppers': '🌶️',
  'artichokes': '🥬',
  'broccoli': '🥦',
  'corn': '🌽',
  'arugula': '🥬',
  'zucchini': '🥒',
  'eggplant': '🍆',
  'sun-dried tomatoes': '🍅',
  // Cheese
  'extra cheese': '🧀',
  'mozzarella': '🧀',
  'parmesan': '🧀',
  'feta': '🧀',
  'ricotta': '🧀',
  'goat cheese': '🧀',
  'gorgonzola': '🧀',
  'cheddar': '🧀',
  // Fruits
  'pineapple': '🍍',
  'banana peppers': '🍌',
  // Other
  'bbq sauce': '🍯',
  'ranch': '🥛',
  'buffalo': '🔥',
  'truffle': '🟤',
  'egg': '🥚',
};

// Get emoji for a topping (case-insensitive)
const getToppingEmoji = (toppingName: string): string => {
  const lower = toppingName.toLowerCase();
  return toppingEmojis[lower] || '•';
};

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

  // Compact version for order summary (3-column grid)
  if (compact) {
    const toppingEmojisDisplay = pizza.toppings.map(t => getToppingEmoji(t.name)).join('');
    const guestNames = pizza.guests.map(g => g.name.split(' ')[0]); // First names only

    return (
      <div className={`p-2 rounded-lg ${pizza.isForNonRespondents ? 'bg-[#6b7280]/20' : 'bg-white/5'} border border-white/10`}>
        <div className="flex items-center justify-between gap-1 mb-1">
          <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${pizza.isForNonRespondents ? 'bg-[#6b7280]' : 'bg-[#ff393a]'} text-white`}>
            {quantity}
          </div>
          <span className="text-[12px]" title={pizza.toppings.map(t => t.name).join(', ')}>
            {toppingEmojisDisplay || '🧀'}
          </span>
        </div>
        <div className="text-white text-[10px] leading-tight line-clamp-2 mb-1">
          {pizza.label || pizza.toppings.map(t => t.name).join(', ') || 'Cheese'}
        </div>
        {pizza.dietaryRestrictions.length > 0 && (
          <div className="flex flex-wrap gap-0.5 mb-1">
            {pizza.dietaryRestrictions.map(r => (
              <span key={r} className="text-[8px] text-purple-300 bg-purple-500/20 px-1 rounded">
                {r}
              </span>
            ))}
          </div>
        )}
        {!pizza.isForNonRespondents && guestNames.length > 0 && (
          <div className="text-[9px] text-blue-300/80 leading-tight">
            {guestNames.slice(0, 3).join(', ')}
            {guestNames.length > 3 && ` +${guestNames.length - 3}`}
          </div>
        )}
        {pizza.isForNonRespondents && (
          <div className="text-[9px] text-white/40 italic">
            For non-RSVPs
          </div>
        )}
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
