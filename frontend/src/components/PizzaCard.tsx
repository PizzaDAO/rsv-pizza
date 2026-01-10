import React from 'react';
import { PizzaRecommendation } from '../types';
import { Users, Ruler } from 'lucide-react';

interface PizzaCardProps {
  pizza: PizzaRecommendation;
  index: number;
}

export const PizzaCard: React.FC<PizzaCardProps> = ({ pizza, index }) => {
  // Group toppings by category
  const groupedToppings = pizza.toppings.reduce((acc, topping) => {
    if (!acc[topping.category]) {
      acc[topping.category] = [];
    }
    acc[topping.category].push(topping);
    return acc;
  }, {} as Record<string, typeof pizza.toppings>);

  // Colors for different topping categories
  const categoryColors: Record<string, string> = {
    meat: 'bg-red-500/20 text-red-300 border-red-500/30',
    vegetable: 'bg-green-500/20 text-green-300 border-green-500/30',
    cheese: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    fruit: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  };

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden bg-white/5 hover:bg-white/[0.07] transition-all">
      <div className="bg-gradient-to-r from-[#ff393a] to-[#ff6b35] py-3 px-4">
        <div className="flex justify-between items-center">
          <h3 className="text-white font-bold">Pizza #{index + 1}</h3>
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1 bg-white/20 rounded-full px-2.5 py-1">
              <Ruler size={14} className="text-white" />
              <span className="text-white text-xs">
                {pizza.size.diameter}" {pizza.style.name}
              </span>
            </div>
            <div className="flex items-center space-x-1 bg-white/20 rounded-full px-2.5 py-1">
              <Users size={14} className="text-white" />
              <span className="text-white text-xs">
                {pizza.guests.length}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-medium text-white/70">Toppings</h4>
            <span className="text-xs text-white/40">{pizza.style.description}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(groupedToppings).flatMap(([category, toppings]) =>
              toppings.map(topping => (
                <span
                  key={topping.id}
                  className={`px-2 py-0.5 rounded-full text-xs font-medium border ${categoryColors[category] || 'bg-white/10 text-white/70 border-white/20'}`}
                >
                  {topping.name}
                </span>
              ))
            )}
          </div>
        </div>

        {pizza.dietaryRestrictions.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium text-white/70 mb-2">Dietary</h4>
            <div className="flex flex-wrap gap-1.5">
              {pizza.dietaryRestrictions.map(restriction => (
                <span key={restriction} className="px-2 py-0.5 bg-purple-500/20 text-purple-300 text-xs rounded-full border border-purple-500/30">
                  {restriction}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-white/10">
          <h4 className="text-sm font-medium text-white/70 mb-2">Guests</h4>
          <div className="flex flex-wrap gap-1.5">
            {pizza.guests.map(guest => (
              <span key={guest.id} className="px-2 py-0.5 bg-blue-500/20 text-blue-300 text-xs rounded-full border border-blue-500/30">
                {guest.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
