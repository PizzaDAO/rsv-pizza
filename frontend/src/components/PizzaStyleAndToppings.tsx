import React, { useState, useEffect } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { Pizza, Plus, X } from 'lucide-react';

interface PizzaStyleAndToppingsProps {
  children?: React.ReactNode;
}

export const PizzaStyleAndToppings: React.FC<PizzaStyleAndToppingsProps> = ({ children }) => {
  const {
    party,
    pizzaSettings,
    updatePizzaSettings,
    pizzaStyles,
    availableToppings,
    updatePartyToppings
  } = usePizza();

  // Pizza style
  const handleStyleChange = (styleId: string) => {
    const style = pizzaStyles.find(s => s.id === styleId);
    if (style) {
      updatePizzaSettings({ ...pizzaSettings, style });
    }
  };

  // Toppings
  const [selectedToppings, setSelectedToppings] = useState<string[]>(() => {
    if (party?.availableToppings && party.availableToppings.length > 0) {
      return party.availableToppings;
    }
    return availableToppings.map(t => t.id);
  });

  const [customToppings, setCustomToppings] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');

  useEffect(() => {
    if (party?.availableToppings && party.availableToppings.length > 0) {
      setSelectedToppings(party.availableToppings);
    }
  }, [party?.availableToppings]);

  const toggleTopping = (toppingId: string) => {
    const newSelection = selectedToppings.includes(toppingId)
      ? selectedToppings.filter(id => id !== toppingId)
      : [...selectedToppings, toppingId];
    setSelectedToppings(newSelection);
    updatePartyToppings(newSelection);
  };

  const addCustomTopping = () => {
    if (customInput.trim()) {
      const customId = `custom-${Date.now()}`;
      setCustomToppings(prev => [...prev, customInput.trim()]);
      const newSelection = [...selectedToppings, customId];
      setSelectedToppings(newSelection);
      updatePartyToppings(newSelection);
      setCustomInput('');
    }
  };

  const removeCustomTopping = (index: number) => {
    setCustomToppings(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-6">
        <Pizza size={24} className="text-[#ff393a]" />
        <h2 className="text-xl font-bold text-white">Pizza Options</h2>
      </div>

      {/* Pizza Style Section */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-3">Style</h3>
        <div className="space-y-2">
          {pizzaStyles.map(style => (
            <label key={style.id} className="flex items-start space-x-3 cursor-pointer group">
              <input
                type="radio"
                name="pizzaStyle"
                value={style.id}
                checked={pizzaSettings.style.id === style.id}
                onChange={() => handleStyleChange(style.id)}
                className="w-4 h-4 text-[#ff393a] bg-white/10 border-white/20 focus:ring-[#ff393a] focus:ring-offset-0 mt-1"
              />
              <div className="flex-1">
                <div className="font-medium text-white/90 group-hover:text-white">{style.name}</div>
                <div className="text-sm text-white/40">{style.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-white/10 my-6" />

      {/* Toppings Section */}
      <div>
        <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-3">Available Toppings</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
          {availableToppings.map(topping => (
            <button
              key={topping.id}
              type="button"
              onClick={() => toggleTopping(topping.id)}
              className={`chip ${selectedToppings.includes(topping.id) ? 'active' : ''}`}
            >
              {topping.name}
            </button>
          ))}
          {customToppings.map((custom, index) => (
            <div key={`custom-${index}`} className="chip active relative pr-8">
              {custom}
              <button
                type="button"
                onClick={() => removeCustomTopping(index)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/60 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustomTopping();
              }
            }}
            placeholder="Add custom topping"
            className="flex-1"
          />
          <button
            type="button"
            onClick={addCustomTopping}
            className="btn-secondary flex items-center gap-2 px-4"
          >
            <Plus size={18} />
            Add
          </button>
        </div>
      </div>

      {/* Additional content passed as children */}
      {children}
    </div>
  );
};
