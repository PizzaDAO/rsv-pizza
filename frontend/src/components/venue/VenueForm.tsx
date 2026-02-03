import React, { useState } from 'react';
import { X, Loader2, MapPin, Users, DollarSign, User, Phone, Mail, Globe, FileText, Building2 } from 'lucide-react';
import { Venue, VenueStatus } from '../../types';
import { VenueCreateData } from '../../lib/api';
import { IconInput } from '../IconInput';

interface VenueFormProps {
  venue?: Venue;
  onSave: (data: VenueCreateData) => Promise<void>;
  onClose: () => void;
}

const venueStatusOptions: { value: VenueStatus; label: string }[] = [
  { value: 'researching', label: 'Researching' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'deposit_paid', label: 'Deposit Paid' },
  { value: 'paid_in_full', label: 'Paid in Full' },
  { value: 'declined', label: 'Declined' },
];

export const VenueForm: React.FC<VenueFormProps> = ({ venue, onSave, onClose }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState(venue?.name || '');
  const [address, setAddress] = useState(venue?.address || '');
  const [website, setWebsite] = useState(venue?.website || '');
  const [capacity, setCapacity] = useState(venue?.capacity?.toString() || '');
  const [cost, setCost] = useState(venue?.cost?.toString() || '');
  const [organization, setOrganization] = useState(venue?.organization || '');
  const [pointPerson, setPointPerson] = useState(venue?.pointPerson || '');
  const [contactName, setContactName] = useState(venue?.contactName || '');
  const [contactEmail, setContactEmail] = useState(venue?.contactEmail || '');
  const [contactPhone, setContactPhone] = useState(venue?.contactPhone || '');
  const [status, setStatus] = useState<VenueStatus>(venue?.status || 'researching');
  const [notes, setNotes] = useState(venue?.notes || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Venue name is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave({
        name: name.trim(),
        address: address.trim() || undefined,
        website: website.trim() || undefined,
        capacity: capacity ? parseInt(capacity, 10) : undefined,
        cost: cost ? parseFloat(cost) : undefined,
        organization: organization.trim() || undefined,
        pointPerson: pointPerson.trim() || undefined,
        contactName: contactName.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        status,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save venue');
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
            <h2 className="text-lg font-semibold text-white">
              {venue ? 'Edit Venue' : 'Add Venue Option'}
            </h2>
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

            <IconInput
              icon={MapPin}
              iconSize={16}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Venue Name *"
              autoFocus
            />

            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address"
              rows={2}
              className="w-full resize-none"
            />

            <div className="grid grid-cols-2 gap-3">
              <IconInput
                icon={Globe}
                iconSize={16}
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="Website / Map Link"
              />
              <IconInput
                icon={Users}
                iconSize={16}
                type="number"
                min={0}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="Capacity"
              />
            </div>

            <IconInput
              icon={Building2}
              iconSize={16}
              type="text"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="Organization / Company"
            />
          </div>

          {/* Status & Cost Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white/60">Status & Cost</h3>

            <div className="grid grid-cols-2 gap-3">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as VenueStatus)}
                className="w-full appearance-none cursor-pointer"
                style={{ colorScheme: 'dark' }}
              >
                {venueStatusOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-[#1a1a2e]">
                    {option.label}
                  </option>
                ))}
              </select>

              <IconInput
                icon={DollarSign}
                iconSize={16}
                type="number"
                min={0}
                step={0.01}
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="Cost"
              />
            </div>

            <IconInput
              icon={User}
              iconSize={16}
              type="text"
              value={pointPerson}
              onChange={(e) => setPointPerson(e.target.value)}
              placeholder="Point Person (your team)"
            />
          </div>

          {/* Contact Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white/60">Venue Contact</h3>

            <IconInput
              icon={User}
              iconSize={16}
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Contact Name"
            />

            <div className="grid grid-cols-2 gap-3">
              <IconInput
                icon={Mail}
                iconSize={16}
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="Contact Email"
              />
              <IconInput
                icon={Phone}
                iconSize={16}
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="Contact Phone"
              />
            </div>
          </div>

          {/* Notes Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white/60">Notes</h3>
            <div className="relative">
              <FileText size={16} className="absolute left-3 top-3 text-white/40 pointer-events-none" />
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes about this venue option..."
                rows={3}
                className="w-full !pl-10 resize-none"
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
              disabled={saving || !name.trim()}
              className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving...
                </>
              ) : venue ? (
                'Save Changes'
              ) : (
                'Add Venue'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
