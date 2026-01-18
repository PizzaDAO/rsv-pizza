import React, { useState, useMemo } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { AddGuestForm } from './AddGuestForm';
import { UserRoundX, UserPlus, ChevronDown, ChevronUp, Trash2, Check, X } from 'lucide-react';
import { format } from 'date-fns';
import { getToppingEmoji } from '../utils/toppingEmojis';

const INITIAL_VISIBLE_COUNT = 10;

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

export const GuestPreferencesList: React.FC = () => {
  const { guests, removeGuest, approveGuest, declineGuest, party, availableToppings, availableBeverages } = usePizza();
  const [showAddForm, setShowAddForm] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const toppingNameById = (id: string) => {
    return availableToppings.find(t => t.id === id)?.name || id;
  };

  const beverageNameById = (id: string) => {
    return availableBeverages.find(b => b.id === id)?.name || id;
  };

  // Filter to only guests who submitted requests (have any preferences)
  const guestsWithRequests = useMemo(() => {
    return guests.filter(guest =>
      (guest.dietaryRestrictions && guest.dietaryRestrictions.length > 0) ||
      (guest.toppings && guest.toppings.length > 0) ||
      (guest.dislikedToppings && guest.dislikedToppings.length > 0) ||
      (guest.likedBeverages && guest.likedBeverages.length > 0) ||
      (guest.dislikedBeverages && guest.dislikedBeverages.length > 0)
    );
  }, [guests]);

  const visibleGuests = expanded
    ? guestsWithRequests
    : guestsWithRequests.slice(0, INITIAL_VISIBLE_COUNT);

  const hiddenCount = guestsWithRequests.length - INITIAL_VISIBLE_COUNT;
  const hasMore = hiddenCount > 0;
  const requireApproval = party?.requireApproval || false;

  if (guestsWithRequests.length === 0) {
    return (
      <>
        <div className="card p-6 flex flex-col items-center justify-center min-h-[200px] text-center">
          <UserRoundX size={48} className="text-white/30 mb-4" />
          <h3 className="text-xl font-medium text-white/80">No Guest Requests Yet</h3>
          <p className="text-white/50 mt-2 mb-4">
            {guests.length > 0
              ? `${guests.length} guests have RSVP'd but none have submitted pizza requests yet.`
              : 'Guest requests will appear here once they RSVP.'}
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="btn-primary flex items-center gap-2"
          >
            <UserPlus size={18} />
            <span>Add Request</span>
          </button>
        </div>

        {/* Add Guest Form Modal */}
        {showAddForm && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <AddGuestForm onClose={() => setShowAddForm(false)} />
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="card p-6">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white">Guest Requests</h2>
            <span className="bg-[#ff393a]/20 text-[#ff393a] text-sm font-medium px-3 py-1 rounded-full border border-[#ff393a]/30">
              {guestsWithRequests.length} {guestsWithRequests.length === 1 ? 'Request' : 'Requests'}
            </span>
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="btn-primary flex items-center gap-2"
          >
            <UserPlus size={18} />
            <span>Add Request</span>
          </button>
        </div>

        <div className="divide-y divide-white/10">
          {visibleGuests.map(guest => (
            <div
              key={guest.id}
              className="flex items-center gap-3 py-3 group hover:bg-white/5 -mx-2 px-2 rounded-lg transition-colors"
            >
              {/* Avatar */}
              <div className={`w-8 h-8 rounded-full ${getAvatarColor(guest.name)} flex items-center justify-center text-white text-sm font-medium flex-shrink-0`}>
                {guest.name.charAt(0).toUpperCase()}
              </div>

              {/* Name & Preferences */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-white">{guest.name}</span>
                  {/* Dietary restrictions */}
                  {guest.dietaryRestrictions.map(restriction => (
                    <span key={restriction} className="px-1.5 py-0.5 bg-purple-500/20 text-purple-300 text-[10px] rounded border border-purple-500/30">
                      {restriction}
                    </span>
                  ))}
                </div>
                {/* Toppings & Beverages on second line */}
                <div className="flex flex-wrap gap-1 mt-1">
                  {guest.toppings.map(toppingId => {
                    const name = toppingNameById(toppingId);
                    return (
                      <span key={toppingId} className="px-1.5 py-0.5 bg-[#39d98a]/20 text-[#39d98a] text-[10px] rounded">
                        {getToppingEmoji(name)} {name}
                      </span>
                    );
                  })}
                  {guest.dislikedToppings.map(toppingId => {
                    const name = toppingNameById(toppingId);
                    return (
                      <span key={toppingId} className="px-1.5 py-0.5 bg-[#ff393a]/20 text-[#ff393a] text-[10px] rounded line-through">
                        {getToppingEmoji(name)} {name}
                      </span>
                    );
                  })}
                  {guest.likedBeverages?.map(beverageId => {
                    const name = beverageNameById(beverageId);
                    return (
                      <span key={beverageId} className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] rounded">
                        {name}
                      </span>
                    );
                  })}
                  {guest.dislikedBeverages?.map(beverageId => {
                    const name = beverageNameById(beverageId);
                    return (
                      <span key={beverageId} className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] rounded line-through">
                        {name}
                      </span>
                    );
                  })}
                </div>
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

        {hasMore && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full mt-4 py-3 flex items-center justify-center gap-2 text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-colors"
          >
            {expanded ? (
              <>
                <ChevronUp size={18} />
                <span>Show Less</span>
              </>
            ) : (
              <>
                <ChevronDown size={18} />
                <span>Show {hiddenCount} More</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Add Guest Form Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <AddGuestForm onClose={() => setShowAddForm(false)} />
          </div>
        </div>
      )}
    </>
  );
};
