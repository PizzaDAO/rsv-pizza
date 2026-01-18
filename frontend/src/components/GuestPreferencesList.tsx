import React, { useState, useMemo } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { AddGuestForm } from './AddGuestForm';
import { TableRow } from './TableRow';
import { UserRoundX, UserPlus, ChevronDown, ChevronUp } from 'lucide-react';

const INITIAL_VISIBLE_COUNT = 10;

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
            <TableRow
              key={guest.id}
              guest={guest}
              variant="requests"
              requireApproval={requireApproval}
              onApprove={approveGuest}
              onDecline={declineGuest}
              onRemove={removeGuest}
              toppingNameById={toppingNameById}
              beverageNameById={beverageNameById}
            />
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
