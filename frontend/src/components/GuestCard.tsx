import React, { useState } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { Guest } from '../types';
import { Edit2, Trash2 } from 'lucide-react';

interface GuestCardProps {
  guest: Guest;
}

export const GuestCard: React.FC<GuestCardProps> = ({ guest }) => {
  const { removeGuest, updateGuest, availableToppings } = usePizza();
  const [isEditing, setIsEditing] = useState(false);
  const [editedGuest, setEditedGuest] = useState<Guest>({ ...guest });

  const handleSave = () => {
    if (guest.id) {
      updateGuest(guest.id, editedGuest);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedGuest({ ...guest });
    setIsEditing(false);
  };

  const toppingNameById = (id: string) => {
    return availableToppings.find(t => t.id === id)?.name || id;
  };

  if (isEditing) {
    return (
      <div className="border border-white/20 rounded-xl p-4 bg-white/5">
        <div className="mb-3">
          <label htmlFor="editName" className="block text-sm font-medium text-white/70 mb-1">
            Guest Name
          </label>
          <input
            id="editName"
            type="text"
            value={editedGuest.name}
            onChange={(e) => setEditedGuest({ ...editedGuest, name: e.target.value })}
            className="w-full"
          />
        </div>

        <div className="flex justify-end space-x-2 mt-4">
          <button onClick={handleCancel} className="btn-secondary text-sm py-2 px-4">
            Cancel
          </button>
          <button onClick={handleSave} className="btn-primary text-sm py-2 px-4">
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-white/10 rounded-xl p-4 bg-white/5 hover:bg-white/[0.07] hover:border-white/15 transition-all">
      <div className="flex justify-between items-start">
        <h3 className="text-lg font-semibold text-white">{guest.name}</h3>
        <div className="flex space-x-1">
          <button
            onClick={() => setIsEditing(true)}
            className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            aria-label="Edit guest"
          >
            <Edit2 size={16} />
          </button>
          <button
            onClick={() => guest.id && removeGuest(guest.id)}
            className="p-1.5 text-white/40 hover:text-[#ff393a] hover:bg-[#ff393a]/10 rounded-lg transition-colors"
            aria-label="Remove guest"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {guest.dietaryRestrictions.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wide">Dietary</h4>
          <div className="flex flex-wrap gap-1.5">
            {guest.dietaryRestrictions.map(restriction => (
              <span key={restriction} className="px-2 py-0.5 bg-purple-500/20 text-purple-300 text-xs rounded-full border border-purple-500/30">
                {restriction}
              </span>
            ))}
          </div>
        </div>
      )}

      {guest.toppings.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wide">Likes</h4>
          <div className="flex flex-wrap gap-1.5">
            {guest.toppings.map(toppingId => (
              <span key={toppingId} className="px-2 py-0.5 bg-[#39d98a]/20 text-[#39d98a] text-xs rounded-full border border-[#39d98a]/30">
                {toppingNameById(toppingId)}
              </span>
            ))}
          </div>
        </div>
      )}

      {guest.dislikedToppings.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wide">Dislikes</h4>
          <div className="flex flex-wrap gap-1.5">
            {guest.dislikedToppings.map(toppingId => (
              <span key={toppingId} className="px-2 py-0.5 bg-[#ff393a]/20 text-[#ff393a] text-xs rounded-full border border-[#ff393a]/30">
                {toppingNameById(toppingId)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
