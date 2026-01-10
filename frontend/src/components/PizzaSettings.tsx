import React from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { Settings } from 'lucide-react';

export const PizzaSettings: React.FC = () => {
  const { pizzaSettings, updatePizzaSettings, pizzaStyles } = usePizza();

  const handleStyleChange = (styleId: string) => {
    const style = pizzaStyles.find(s => s.id === styleId);
    if (style) {
      updatePizzaSettings({ ...pizzaSettings, style });
    }
  };

  return (
    <div className="card p-6">
      <div className="flex items-center space-x-2 mb-4">
        <Settings size={24} className="text-[#ff393a]" />
        <h2 className="text-xl font-bold text-white">Pizza Style</h2>
      </div>

      <div>
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

      <div className="mt-6 p-4 bg-white/5 rounded-xl border border-white/10">
        <p className="text-sm text-white/60">
          Pizza sizes are automatically calculated based on guest count to minimize waste and maximize satisfaction.
        </p>
      </div>
    </div>
  );
};
