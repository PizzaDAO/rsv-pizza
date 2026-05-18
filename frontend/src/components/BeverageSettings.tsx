import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePizza } from '../contexts/PizzaContext';
import { Beer, Plus, X } from 'lucide-react';
import { Checkbox } from './Checkbox';
import { IconInput } from './IconInput';

export const BeverageSettings: React.FC = () => {
  const { t } = useTranslation('host');
  const { party, availableBeverages, updatePartyBeverages } = usePizza();
  const [selectedBeverages, setSelectedBeverages] = useState<string[]>(
    // Filter out old opaque custom-{timestamp} IDs on load — their names are lost
    (party?.availableBeverages || []).filter(id => !id.startsWith('custom-'))
  );
  const [customBeverages, setCustomBeverages] = useState<string[]>(() => {
    return (party?.availableBeverages || [])
      .filter(id => id.startsWith('custom:'))
      .map(id => id.slice('custom:'.length));
  });
  const [customInput, setCustomInput] = useState('');

  const isGppEvent = party?.eventType === 'gpp';
  if (isGppEvent) return null;

  const toggleBeverage = (beverageId: string) => {
    const newSelection = selectedBeverages.includes(beverageId)
      ? selectedBeverages.filter(id => id !== beverageId)
      : [...selectedBeverages, beverageId];
    setSelectedBeverages(newSelection);
    updatePartyBeverages(newSelection);
  };

  const addCustomBeverage = () => {
    const name = customInput.trim();
    if (!name) return;
    // Duplicate check (case-insensitive)
    if (customBeverages.some(b => b.toLowerCase() === name.toLowerCase())) return;
    const customId = `custom:${name}`;
    setCustomBeverages(prev => [...prev, name]);
    const newSelection = [...selectedBeverages, customId];
    setSelectedBeverages(newSelection);
    updatePartyBeverages(newSelection);
    setCustomInput('');
  };

  const removeCustomBeverage = (index: number) => {
    const name = customBeverages[index];
    const customId = `custom:${name}`;
    setCustomBeverages(prev => prev.filter((_, i) => i !== index));
    const newSelection = selectedBeverages.filter(id => id !== customId);
    setSelectedBeverages(newSelection);
    updatePartyBeverages(newSelection);
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-4">
        <Beer size={20} className="text-[#ff393a]" />
        <h2 className="text-xl font-bold text-theme-text">{t('beverages.drinks')}</h2>
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
            key={`custom:${custom}`}
            checked={true}
            onChange={() => {}}
            label={custom}
            disabled
          >
            <button
              type="button"
              onClick={() => removeCustomBeverage(index)}
              className="text-theme-text-muted hover:text-theme-text ml-auto"
            >
              <X size={14} />
            </button>
          </Checkbox>
        ))}
      </div>

      <div className="flex gap-2">
        <IconInput
          icon={Beer}
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustomBeverage();
            }
          }}
          placeholder={t('beverages.addCustomDrink')}
          className="flex-1"
        />
        <button
          type="button"
          onClick={addCustomBeverage}
          className="btn-secondary flex items-center gap-2 px-4"
        >
          <Plus size={18} />
          {t('beverages.add')}
        </button>
      </div>
    </div>
  );
};
