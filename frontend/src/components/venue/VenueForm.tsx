import React, { useState } from 'react';
import { X, Loader2, MapPin, Users, DollarSign, User, Phone, Mail, Globe, FileText, Building2 } from 'lucide-react';
import { Party, VenueStatus } from '../../types';

interface VenueFormProps {
  party: Party;
  onSave: (updates: Record<string, any>) => Promise<boolean>;
  onClose: () => void;
}

const venueStatusOptions: { value: VenueStatus | ''; label: string }[] = [
  { value: '', label: 'No status' },
  { value: 'researching', label: 'Researching' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'deposit_paid', label: 'Deposit Paid' },
  { value: 'paid_in_full', label: 'Paid in Full' },
];

export const VenueForm: React.FC<VenueFormProps> = ({ party, onSave, onClose }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [venueName, setVenueName] = useState(party.venueName || '');
  const [address, setAddress] = useState(party.address || '');
  const [venueStatus, setVenueStatus] = useState<VenueStatus | ''>(party.venueStatus || '');
  const [venueCapacity, setVenueCapacity] = useState(party.venueCapacity?.toString() || '');
  const [venueCost, setVenueCost] = useState(party.venueCost?.toString() || '');
  const [venuePointPerson, setVenuePointPerson] = useState(party.venuePointPerson || '');
  const [venueContactName, setVenueContactName] = useState(party.venueContactName || '');
  const [venueContactEmail, setVenueContactEmail] = useState(party.venueContactEmail || '');
  const [venueContactPhone, setVenueContactPhone] = useState(party.venueContactPhone || '');
  const [venueOrganization, setVenueOrganization] = useState(party.venueOrganization || '');
  const [venueWebsite, setVenueWebsite] = useState(party.venueWebsite || '');
  const [venueNotes, setVenueNotes] = useState(party.venueNotes || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const updates = {
        venue_name: venueName.trim() || null,
        address: address.trim() || null,
        venueStatus: venueStatus || null,
        venueCapacity: venueCapacity ? parseInt(venueCapacity, 10) : null,
        venueCost: venueCost ? parseFloat(venueCost) : null,
        venuePointPerson: venuePointPerson.trim() || null,
        venueContactName: venueContactName.trim() || null,
        venueContactEmail: venueContactEmail.trim() || null,
        venueContactPhone: venueContactPhone.trim() || null,
        venueOrganization: venueOrganization.trim() || null,
        venueWebsite: venueWebsite.trim() || null,
        venueNotes: venueNotes.trim() || null,
      };

      const success = await onSave(updates);
      if (!success) {
        throw new Error('Failed to save venue information');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 p-4 bg-black/70 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl max-w-lg w-full my-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <MapPin size={20} className="text-[#ff393a]" />
            <h2 className="text-lg font-semibold text-white">Venue Information</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Venue Info Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white/60">Venue Details</h3>

            <div className="relative">
              <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                placeholder="Venue Name"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] pl-10"
              />
            </div>

            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address"
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] resize-none"
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type="url"
                  value={venueWebsite}
                  onChange={(e) => setVenueWebsite(e.target.value)}
                  placeholder="Website / Map Link"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] pl-10"
                />
              </div>
              <div className="relative">
                <Users size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type="number"
                  min="0"
                  value={venueCapacity}
                  onChange={(e) => setVenueCapacity(e.target.value)}
                  placeholder="Capacity"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] pl-10"
                />
              </div>
            </div>

            <div className="relative">
              <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                value={venueOrganization}
                onChange={(e) => setVenueOrganization(e.target.value)}
                placeholder="Organization / Company"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] pl-10"
              />
            </div>
          </div>

          {/* Status & Cost Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white/60">Status & Cost</h3>

            <div className="grid grid-cols-2 gap-3">
              <select
                value={venueStatus}
                onChange={(e) => setVenueStatus(e.target.value as VenueStatus | '')}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] appearance-none cursor-pointer"
                style={{ colorScheme: 'dark' }}
              >
                {venueStatusOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-[#1a1a2e]">
                    {option.label}
                  </option>
                ))}
              </select>

              <div className="relative">
                <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={venueCost}
                  onChange={(e) => setVenueCost(e.target.value)}
                  placeholder="Cost"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] pl-10"
                />
              </div>
            </div>

            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                value={venuePointPerson}
                onChange={(e) => setVenuePointPerson(e.target.value)}
                placeholder="Point Person (your team)"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] pl-10"
              />
            </div>
          </div>

          {/* Contact Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white/60">Venue Contact</h3>

            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                value={venueContactName}
                onChange={(e) => setVenueContactName(e.target.value)}
                placeholder="Contact Name"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] pl-10"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type="email"
                  value={venueContactEmail}
                  onChange={(e) => setVenueContactEmail(e.target.value)}
                  placeholder="Contact Email"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] pl-10"
                />
              </div>
              <div className="relative">
                <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type="tel"
                  value={venueContactPhone}
                  onChange={(e) => setVenueContactPhone(e.target.value)}
                  placeholder="Contact Phone"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] pl-10"
                />
              </div>
            </div>
          </div>

          {/* Notes Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white/60">Notes</h3>
            <div className="relative">
              <FileText size={16} className="absolute left-3 top-3 text-white/40" />
              <textarea
                value={venueNotes}
                onChange={(e) => setVenueNotes(e.target.value)}
                placeholder="Additional notes about the venue..."
                rows={3}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] pl-10 resize-none"
              />
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 rounded-lg text-sm bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a]">
              {error}
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
              disabled={saving}
              className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Venue'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
