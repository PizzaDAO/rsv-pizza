import React, { useState } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { Beer, Plus, X } from 'lucide-react';
import { Checkbox } from './Checkbox';

export const BeverageSettings: React.FC = () => {
  const { party, availableBeverages, updatePartyBeverages } = usePizza();
  const [selectedBeverages, setSelectedBeverages] = useState<string[]>(
    party?.availableBeverages || []
  );
  const [customBeverages, setCustomBeverages] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');

  const toggleBeverage = (beverageId: string) => {
    const newSelection = selectedBeverages.includes(beverageId)
      ? selectedBeverages.filter(id => id !== beverageId)
      : [...selectedBeverages, beverageId];
    setSelectedBeverages(newSelection);
    updatePartyBeverages(newSelection);
  };

  const addCustomBeverage = () => {
    if (customInput.trim()) {
      const customId = `custom-${Date.now()}`;
      setCustomBeverages(prev => [...prev, customInput.trim()]);
      const newSelection = [...selectedBeverages, customId];
      setSelectedBeverages(newSelection);
      updatePartyBeverages(newSelection);
      setCustomInput('');
    }
  };

  const removeCustomBeverage = (index: number) => {
    setCustomBeverages(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-4">
        <Beer size={20} className="text-[#ff393a]" />
        <h2 className="text-xl font-bold text-white">Drinks</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
        {availableBeverages.map(beverage => (
          <Checkbox
            key={beverage.id}
            checked={selectedBeverages.includes(beverage.id)}
            onChange={() => toggleBeverage(beverage.id)}
            label={beverage.name}
          />
        ))}
        {customBeverages.map((custom, index) => (
          <Checkbox
            key={`custom-${index}`}
            checked={true}
            onChange={() => {}}
            label={custom}
            disabled
          >
            <button
              type="button"
              onClick={() => removeCustomBeverage(index)}
              className="text-white/40 hover:text-white ml-auto"
            >
              <X size={14} />
            </button>
          </Checkbox>
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
              addCustomBeverage();
            }
          }}
          placeholder="Add custom drink"
          className="flex-1"
        />
        <button
          type="button"
          onClick={addCustomBeverage}
          className="btn-secondary flex items-center gap-2 px-4"
        >
          <Plus size={18} />
          Add
        </button>
      </div>
    </div>
  );
};
