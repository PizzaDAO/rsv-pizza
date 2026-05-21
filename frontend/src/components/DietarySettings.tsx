import React, { useState } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { Leaf, Plus, X } from 'lucide-react';
import { Checkbox } from './Checkbox';
import { IconInput } from './IconInput';
import { DIETARY_OPTIONS } from '../constants/options';

export const DietarySettings: React.FC = () => {
  const { party, updatePartyDietaryOptions, updatePartyShowToppingsOnRsvp } = usePizza();
  const [selectedOptions, setSelectedOptions] = useState<string[]>(
    (party?.availableDietaryOptions || []).filter(id => !id.startsWith('custom-'))
  );
  const [customOptions, setCustomOptions] = useState<string[]>(() => {
    return (party?.availableDietaryOptions || [])
      .filter(id => id.startsWith('custom:'))
      .map(id => id.slice('custom:'.length));
  });
  const [customInput, setCustomInput] = useState('');

  const toggleOption = (option: string) => {
    const newSelection = selectedOptions.includes(option)
      ? selectedOptions.filter(id => id !== option)
      : [...selectedOptions, option];
    setSelectedOptions(newSelection);
    updatePartyDietaryOptions(newSelection);
  };

  const addCustomOption = () => {
    const name = customInput.trim();
    if (!name) return;
    // Duplicate check (case-insensitive)
    if (customOptions.some(o => o.toLowerCase() === name.toLowerCase())) return;
    // Also check against default options
    if (DIETARY_OPTIONS.some(o => o.toLowerCase() === name.toLowerCase())) return;
    const customId = `custom:${name}`;
    setCustomOptions(prev => [...prev, name]);
    const newSelection = [...selectedOptions, customId];
    setSelectedOptions(newSelection);
    updatePartyDietaryOptions(newSelection);
    setCustomInput('');
  };

  const removeCustomOption = (index: number) => {
    const name = customOptions[index];
    const customId = `custom:${name}`;
    setCustomOptions(prev => prev.filter((_, i) => i !== index));
    const newSelection = selectedOptions.filter(id => id !== customId);
    setSelectedOptions(newSelection);
    updatePartyDietaryOptions(newSelection);
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-4">
        <Leaf size={20} className="text-[#ff393a]" />
        <h2 className="text-xl font-bold text-theme-text">Dietary Options</h2>
      </div>

      <div className="mb-4 pb-4 border-b border-theme-stroke">
        <Checkbox
          checked={!!party?.showToppingsOnRsvp}
          onChange={() => updatePartyShowToppingsOnRsvp(!party?.showToppingsOnRsvp)}
          label="Also show topping preferences on RSVP form"
        />
        <p className="text-xs text-theme-text-muted mt-2 ml-7">
          When on, guests can like/dislike toppings on the RSVP form. Otherwise only dietary options show.
        </p>
      </div>

      <p className="text-xs text-theme-text-muted mb-4">
        Select which dietary options guests can choose from. If none are selected, all defaults are shown.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
        {DIETARY_OPTIONS.map(option => (
          <Checkbox
            key={option}
            checked={selectedOptions.includes(option)}
            onChange={() => toggleOption(option)}
            label={option}
          />
        ))}
        {customOptions.map((custom, index) => (
          <Checkbox
            key={`custom:${custom}`}
            checked={true}
            onChange={() => {}}
            label={custom}
            disabled
          >
            <button
              type="button"
              onClick={() => removeCustomOption(index)}
              className="text-theme-text-muted hover:text-theme-text ml-auto"
            >
              <X size={14} />
            </button>
          </Checkbox>
        ))}
      </div>

      <div className="flex gap-2">
        <IconInput
          icon={Leaf}
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustomOption();
            }
          }}
          placeholder="Add custom diet option"
          className="flex-1"
        />
        <button
          type="button"
          onClick={addCustomOption}
          className="btn-secondary flex items-center gap-2 px-4"
        >
          <Plus size={18} />
          Add
        </button>
      </div>
    </div>
  );
};
