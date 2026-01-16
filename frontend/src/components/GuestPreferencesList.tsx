import React, { useState } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { GuestCard } from './GuestCard';
import { AddGuestForm } from './AddGuestForm';
import { UserRoundX, UserPlus } from 'lucide-react';

export const GuestPreferencesList: React.FC = () => {
  const { guests } = usePizza();
  const [showAddForm, setShowAddForm] = useState(false);

  if (guests.length === 0) {
    return (
      <>
        <div className="card p-6 flex flex-col items-center justify-center min-h-[200px] text-center">
          <UserRoundX size={48} className="text-white/30 mb-4" />
          <h3 className="text-xl font-medium text-white/80">No Guest Requests Yet</h3>
          <p className="text-white/50 mt-2 mb-4">
            Guest requests will appear here once they RSVP.
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
              {guests.length} {guests.length === 1 ? 'Guest' : 'Guests'}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {guests.map(guest => (
            <GuestCard key={guest.id} guest={guest} />
          ))}
        </div>
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
