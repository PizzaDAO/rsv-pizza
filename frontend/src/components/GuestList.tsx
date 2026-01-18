import React from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { UserRoundX, Trash2, Check, X } from 'lucide-react';
import { format } from 'date-fns';

// Generate a consistent color based on name
const getAvatarColor = (name: string) => {
  const colors = [
    'bg-red-400', 'bg-orange-400', 'bg-amber-400', 'bg-yellow-400',
    'bg-lime-400', 'bg-green-400', 'bg-emerald-400', 'bg-teal-400',
    'bg-cyan-400', 'bg-sky-400', 'bg-blue-400', 'bg-indigo-400',
    'bg-violet-400', 'bg-purple-400', 'bg-fuchsia-400', 'bg-pink-400',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

export const GuestList: React.FC = () => {
  const { guests, removeGuest, approveGuest, declineGuest, party } = usePizza();

  if (guests.length === 0) {
    return (
      <div className="card p-6 flex flex-col items-center justify-center min-h-[200px] text-center">
        <UserRoundX size={48} className="text-white/30 mb-4" />
        <h3 className="text-xl font-medium text-white/80">No Guests Yet</h3>
        <p className="text-white/50 mt-2">
          Share your event link to start receiving RSVPs.
        </p>
      </div>
    );
  }

  const requireApproval = party?.requireApproval || false;

  return (
    <div className="card p-6">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">Guests</h2>
          <span className="bg-[#ff393a]/20 text-[#ff393a] text-sm font-medium px-3 py-1 rounded-full border border-[#ff393a]/30">
            {guests.length}
          </span>
        </div>
      </div>

      <div className="divide-y divide-white/10">
        {guests.map(guest => (
          <div
            key={guest.id}
            className="flex items-center gap-3 py-3 group hover:bg-white/5 -mx-2 px-2 rounded-lg transition-colors"
          >
            {/* Avatar */}
            <div className={`w-8 h-8 rounded-full ${getAvatarColor(guest.name)} flex items-center justify-center text-white text-sm font-medium flex-shrink-0`}>
              {guest.name.charAt(0).toUpperCase()}
            </div>

            {/* Name & Email */}
            <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-white">{guest.name}</span>
              {guest.email && (
                <span className="text-white/50 text-sm truncate">{guest.email}</span>
              )}
              {guest.roles && guest.roles.length > 0 && (
                <div className="flex gap-1">
                  {guest.roles.map(role => (
                    <span key={role} className="px-1.5 py-0.5 bg-white/10 text-white/60 text-[10px] rounded">
                      {role}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Approve/Decline buttons */}
            {requireApproval && guest.approved === null && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => guest.id && approveGuest(guest.id)}
                  className="flex items-center gap-1 text-[#39d98a] hover:bg-[#39d98a]/10 px-2 py-1 rounded transition-colors text-sm"
                >
                  <Check size={14} />
                  <span>Approve</span>
                </button>
                <button
                  onClick={() => guest.id && declineGuest(guest.id)}
                  className="flex items-center gap-1 text-[#ff393a] hover:bg-[#ff393a]/10 px-2 py-1 rounded transition-colors text-sm"
                >
                  <X size={14} />
                  <span>Decline</span>
                </button>
              </div>
            )}

            {/* Status badge for approved/declined */}
            {requireApproval && guest.approved === true && (
              <span className="text-[#39d98a] text-xs flex-shrink-0">Approved</span>
            )}
            {requireApproval && guest.approved === false && (
              <span className="text-[#ff393a] text-xs flex-shrink-0">Declined</span>
            )}

            {/* Date */}
            {guest.submittedAt && (
              <span className="text-white/40 text-sm hidden sm:block flex-shrink-0">
                {format(new Date(guest.submittedAt), 'MMM d, yyyy')}
              </span>
            )}

            {/* Delete */}
            <button
              onClick={() => guest.id && removeGuest(guest.id)}
              className="p-1.5 text-white/30 hover:text-[#ff393a] hover:bg-[#ff393a]/10 rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
              aria-label="Remove guest"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
