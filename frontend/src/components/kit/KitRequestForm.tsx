import React, { useState } from 'react';
import { X, Loader2, AlertCircle, MapPin, Info, Gift, Package, Star, Check } from 'lucide-react';
import { KIT_TIERS, PartyKit } from '../../types';
import { KitRequestData } from '../../lib/api';
import { ShippingAddressAutocomplete, AddressComponents } from './ShippingAddressAutocomplete';

interface KitRequestFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<KitRequestData, 'requestedTier'>) => Promise<void>;
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

  // Helper to get tier icon
  const getTierIcon = (tierId: string) => {
    switch (tierId) {
      case 'basic':
        return <Gift size={18} />;
      case 'large':
        return <Package size={18} />;
      case 'deluxe':
        return <Star size={18} />;
      default:
        return <Gift size={18} />;
    }
  };

  // Handle address autocomplete selection
  const handleAddressSelected = (components: AddressComponents) => {
    if (components.addressLine1) setAddressLine1(components.addressLine1);
    if (components.city) setCity(components.city);
    if (components.state) setState(components.state);
    if (components.postalCode) setPostalCode(components.postalCode);
    if (components.country) setCountry(components.country);
  };

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-theme-stroke">
          <h2 className="text-lg font-semibold text-theme-text">
            {isEditing ? 'Edit Kit Request' : 'Request Party Kit'}
          </h2>
          <button
            onClick={onClose}
            className="text-theme-text-muted hover:text-theme-text p-1"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-6">
          {/* Deadline Warning */}
          {kitDeadline && !isDeadlinePassed && (
            <div className="flex items-start gap-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <AlertCircle size={18} className="text-yellow-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-yellow-400 font-medium">Deadline</p>
                <p className="text-xs text-theme-text-secondary">
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
                <p className="text-xs text-theme-text-secondary">
                  The deadline for requesting a kit has passed.
                </p>
              </div>
            </div>
          )}

          {/* Kit Information */}
          <div className="p-4 bg-[#ff393a]/10 border border-[#ff393a]/30 rounded-xl">
            <div className="flex items-start gap-3 mb-3">
              <Info size={18} className="text-[#ff393a] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-theme-text font-medium">Party Kit Request</p>
                <p className="text-xs text-theme-text-secondary mt-1">
                  PizzaDAO will review your event and assign the appropriate kit tier based on your party size and requirements.
                </p>
              </div>
            </div>

            {/* Kit tier info */}
            <div className="mt-3 space-y-3 pt-3 border-t border-theme-stroke">
                {KIT_TIERS.map((tier) => (
                  <div key={tier.id} className="bg-theme-surface rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[#ff393a]">{getTierIcon(tier.id)}</span>
                      <span className="text-sm font-medium text-theme-text">{tier.name}</span>
                    </div>
                    <p className="text-xs text-theme-text-muted mb-2">{tier.description}</p>
                    <div className="flex flex-wrap gap-1">
                      {tier.contents.map((item, index) => (
                        <span key={index} className="inline-flex items-center gap-1 text-xs bg-theme-surface-hover text-theme-text-secondary px-2 py-0.5 rounded">
                          <Check size={10} className="text-[#ff393a]" />
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          {/* Shipping Address */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MapPin size={16} className="text-theme-text-secondary" />
              <label className="text-sm font-medium text-theme-text">
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
                className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
              />

              <ShippingAddressAutocomplete
                value={addressLine1}
                onChange={setAddressLine1}
                onAddressSelected={handleAddressSelected}
                placeholder="Address Line 1 *"
                disabled={isDeadlinePassed}
              />

              <input
                type="text"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                placeholder="Address Line 2 (Apt, Suite, etc.)"
                disabled={isDeadlinePassed}
                className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
              />

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City *"
                  disabled={isDeadlinePassed}
                  className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
                />
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="State/Province"
                  disabled={isDeadlinePassed}
                  className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="Postal Code *"
                  disabled={isDeadlinePassed}
                  className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
                />
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  disabled={isDeadlinePassed}
                  className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c} className="bg-theme-header">
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
                className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-theme-text mb-2">
              Special Requests (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any special requests or notes..."
              disabled={isDeadlinePassed}
              rows={3}
              className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50 resize-none"
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
              className="flex-1 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm"
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
