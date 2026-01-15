import React from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { Guest } from '../types';
import { Trash2 } from 'lucide-react';

interface GuestBasicCardProps {
  guest: Guest;
}

export const GuestBasicCard: React.FC<GuestBasicCardProps> = ({ guest }) => {
  const { removeGuest } = usePizza();

  return (
    <div className="border border-white/10 rounded-lg p-3 bg-white/5 hover:bg-white/[0.07] hover:border-white/15 transition-all group">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-white text-sm">{guest.name}</span>
          </div>

          {guest.email && (
            <p className="text-xs text-white/60 truncate">{guest.email}</p>
          )}

          {guest.ethereumAddress && (
            <p className="text-xs text-white/50 truncate font-mono">{guest.ethereumAddress}</p>
          )}

          {guest.roles && guest.roles.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {guest.roles.map(role => (
                <span key={role} className="px-1.5 py-0.5 bg-white/10 text-white/70 text-[10px] rounded">
                  {role}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => guest.id && removeGuest(guest.id)}
          className="p-1 text-white/30 hover:text-[#ff393a] hover:bg-[#ff393a]/10 rounded transition-colors opacity-0 group-hover:opacity-100"
          aria-label="Remove guest"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};
