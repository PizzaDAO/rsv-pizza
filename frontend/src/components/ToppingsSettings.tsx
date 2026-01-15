import React, { useState, useEffect } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { Pizza, Check, Plus, X } from 'lucide-react';

export const ToppingsSettings: React.FC = () => {
  const { party, availableToppings, updatePartyToppings } = usePizza();

  // Initialize with all toppings selected by default
  const [selectedToppings, setSelectedToppings] = useState<string[]>(() => {
    if (party?.availableToppings && party.availableToppings.length > 0) {
      return party.availableToppings;
    }
    // Default: all toppings selected
    return availableToppings.map(t => t.id);
  });

  const [customToppings, setCustomToppings] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Update selected toppings when party changes
  useEffect(() => {
    if (party?.availableToppings && party.availableToppings.length > 0) {
      setSelectedToppings(party.availableToppings);
    }
  }, [party?.availableToppings]);

  const hasChanges = JSON.stringify(selectedToppings.sort()) !==
                     JSON.stringify((party?.availableToppings || availableToppings.map(t => t.id)).sort());

  const handleSave = async () => {
    setIsSaving(true);
    await updatePartyToppings(selectedToppings);
    setIsSaving(false);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const toggleTopping = (toppingId: string) => {
    setSelectedToppings(prev =>
      prev.includes(toppingId)
        ? prev.filter(id => id !== toppingId)
        : [...prev, toppingId]
    );
  };

  const addCustomTopping = () => {
    if (customInput.trim()) {
      const customId = `custom-${Date.now()}`;
      setCustomToppings(prev => [...prev, customInput.trim()]);
      setSelectedToppings(prev => [...prev, customId]);
      setCustomInput('');
    }
  };

  const removeCustomTopping = (index: number) => {
    setCustomToppings(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-4">
        <Pizza size={20} className="text-[#ff393a]" />
        <h2 className="text-xl font-bold text-white">Toppings</h2>
      </div>

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

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCustomTopping()}
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

      {hasChanges && (
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`btn-primary w-full flex items-center justify-center gap-2 ${
            justSaved ? 'bg-[#39d98a]' : ''
          }`}
        >
          {justSaved ? (
            <>
              <Check size={18} />
              <span>Saved!</span>
            </>
          ) : (
            <span>{isSaving ? 'Saving...' : 'Save Topping Selection'}</span>
          )}
        </button>
      )}
    </div>
  );
};
