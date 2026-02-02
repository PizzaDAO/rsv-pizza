import React, { useState } from 'react';
import { X, Loader2, AlertCircle, MapPin } from 'lucide-react';
import { KitTier, KIT_TIERS, PartyKit } from '../../types';
import { KitTierCard } from './KitTierCard';
import { KitRequestData } from '../../lib/api';

interface KitRequestFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: KitRequestData) => Promise<void>;
  existingKit?: PartyKit | null;
  kitDeadline?: string | null;
}

// Country options
const COUNTRIES = [
  'USA',
  'Canada',
  'Mexico',
  'United Kingdom',
  'Australia',
  'Germany',
  'France',
  'Italy',
  'Spain',
  'Netherlands',
  'Belgium',
  'Switzerland',
  'Austria',
  'Portugal',
  'Ireland',
  'New Zealand',
  'Japan',
  'South Korea',
  'Singapore',
  'Hong Kong',
  'Other',
];

export const KitRequestForm: React.FC<KitRequestFormProps> = ({
  isOpen,
  onClose,
  onSubmit,
  existingKit,
  kitDeadline,
}) => {
  const [selectedTier, setSelectedTier] = useState<KitTier>(existingKit?.requestedTier || 'basic');
  const [recipientName, setRecipientName] = useState(existingKit?.recipientName || '');
  const [addressLine1, setAddressLine1] = useState(existingKit?.addressLine1 || '');
  const [addressLine2, setAddressLine2] = useState(existingKit?.addressLine2 || '');
  const [city, setCity] = useState(existingKit?.city || '');
  const [state, setState] = useState(existingKit?.state || '');
  const [postalCode, setPostalCode] = useState(existingKit?.postalCode || '');
  const [country, setCountry] = useState(existingKit?.country || 'USA');
  const [phone, setPhone] = useState(existingKit?.phone || '');
  const [notes, setNotes] = useState(existingKit?.notes || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDeadlinePassed = kitDeadline && new Date(kitDeadline) < new Date();
  const isEditing = !!existingKit;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate required fields
    if (!recipientName.trim() || !addressLine1.trim() || !city.trim() || !postalCode.trim()) {
      setError('Please fill in all required fields');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        requestedTier: selectedTier,
        recipientName: recipientName.trim(),
        addressLine1: addressLine1.trim(),
        addressLine2: addressLine2.trim() || undefined,
        city: city.trim(),
        state: state.trim() || undefined,
        postalCode: postalCode.trim(),
        country,
        phone: phone.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 pb-10 p-4 bg-black/70 overflow-y-auto" onClick={onClose}>
      <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl w-full max-w-lg my-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? 'Edit Kit Request' : 'Request Party Kit'}
          </h2>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white p-1"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-6 max-h-[calc(100vh-200px)] overflow-y-auto">
          {/* Deadline Warning */}
          {kitDeadline && !isDeadlinePassed && (
            <div className="flex items-start gap-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <AlertCircle size={18} className="text-yellow-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-yellow-400 font-medium">Deadline</p>
                <p className="text-xs text-white/60">
                  Kit requests must be submitted by {new Date(kitDeadline).toLocaleDateString()}
                </p>
              </div>
            </div>
          )}

          {isDeadlinePassed && (
            <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-red-400 font-medium">Deadline Passed</p>
                <p className="text-xs text-white/60">
                  The deadline for requesting a kit has passed.
                </p>
              </div>
            </div>
          )}

          {/* Kit Selection */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-3">
              Select Your Kit
            </label>
            <div className="space-y-3">
              {KIT_TIERS.map((tier) => (
                <KitTierCard
                  key={tier.id}
                  tier={tier}
                  selected={selectedTier === tier.id}
                  onSelect={setSelectedTier}
                  disabled={isDeadlinePassed}
                />
              ))}
            </div>
          </div>

          {/* Shipping Address */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MapPin size={16} className="text-white/60" />
              <label className="text-sm font-medium text-white/80">
                Shipping Address
              </label>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Recipient Name *"
                disabled={isDeadlinePassed}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
              />

              <input
                type="text"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                placeholder="Address Line 1 *"
                disabled={isDeadlinePassed}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
              />

              <input
                type="text"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                placeholder="Address Line 2 (Apt, Suite, etc.)"
                disabled={isDeadlinePassed}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
              />

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City *"
                  disabled={isDeadlinePassed}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
                />
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="State/Province"
                  disabled={isDeadlinePassed}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="Postal Code *"
                  disabled={isDeadlinePassed}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
                />
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  disabled={isDeadlinePassed}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c} className="bg-[#1a1a2e]">
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone (optional)"
                disabled={isDeadlinePassed}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Special Requests (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any special requests or notes..."
              disabled={isDeadlinePassed}
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50 resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-white/10 hover:bg-white/20 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || isDeadlinePassed}
              className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {isEditing ? 'Updating...' : 'Submitting...'}
                </>
              ) : (
                isEditing ? 'Update Request' : 'Submit Request'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
