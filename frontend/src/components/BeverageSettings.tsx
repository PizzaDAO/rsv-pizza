import React, { useState } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { Beer, Check } from 'lucide-react';

export const BeverageSettings: React.FC = () => {
  const { party, availableBeverages, updatePartyBeverages } = usePizza();
  const [selectedBeverages, setSelectedBeverages] = useState<string[]>(
    party?.availableBeverages || []
  );
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const hasChanges = JSON.stringify(selectedBeverages.sort()) !==
                     JSON.stringify((party?.availableBeverages || []).sort());

  const handleSave = async () => {
    setIsSaving(true);
    await updatePartyBeverages(selectedBeverages);
    setIsSaving(false);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const toggleBeverage = (beverageId: string) => {
    setSelectedBeverages(prev =>
      prev.includes(beverageId)
        ? prev.filter(id => id !== beverageId)
        : [...prev, beverageId]
    );
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-4">
        <Beer size={20} className="text-[#ff393a]" />
        <h2 className="text-xl font-bold text-white">Beverage Selection</h2>
      </div>

      <p className="text-sm text-white/60 mb-4">
        Select which beverages will be available at your party
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
        {availableBeverages.map(beverage => (
          <button
            key={beverage.id}
            type="button"
            onClick={() => toggleBeverage(beverage.id)}
            className={`chip ${selectedBeverages.includes(beverage.id) ? 'active' : ''}`}
          >
            {beverage.name}
          </button>
        ))}
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
            <span>{isSaving ? 'Saving...' : 'Save Beverage Selection'}</span>
          )}
        </button>
      )}
    </div>
  );
};
