import React, { useState, useRef, useCallback } from 'react';
import { X, Loader2, MapPin, Users, DollarSign, User, Phone, Mail, Globe, FileText, Building2, Link } from 'lucide-react';
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

/** Check if a string looks like a Google Maps URL */
function isGoogleMapsUrl(text: string): boolean {
  return /google\.\w+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(text);
}

/** Extract a place name query from a Google Maps URL */
function extractPlaceQuery(url: string): string | null {
  try {
    const u = new URL(url);

    // /maps/place/Place+Name/... → "Place Name"
    const placeMatch = u.pathname.match(/\/place\/([^/@]+)/);
    if (placeMatch) {
      return decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
    }

    // /maps/search/query/... → "query"
    const searchMatch = u.pathname.match(/\/search\/([^/@]+)/);
    if (searchMatch) {
      return decodeURIComponent(searchMatch[1].replace(/\+/g, ' '));
    }

    // ?q=Place+Name
    const q = u.searchParams.get('q');
    if (q) return q;

    return null;
  } catch {
    return null;
  }
}

/** Use Google Places API to look up a place by text query */
function lookupPlace(query: string): Promise<google.maps.places.PlaceResult | null> {
  return new Promise((resolve) => {
    if (!window.google?.maps?.places) {
      resolve(null);
      return;
    }

    // PlacesService needs a DOM element (can be a hidden div)
    const div = document.createElement('div');
    const service = new google.maps.places.PlacesService(div);

    service.findPlaceFromQuery(
      {
        query,
        fields: ['name', 'formatted_address', 'formatted_phone_number', 'website', 'place_id'],
      },
      (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results?.[0]) {
          // findPlaceFromQuery doesn't return phone/website — need getDetails
          const placeId = results[0].place_id;
          if (placeId) {
            service.getDetails(
              {
                placeId,
                fields: ['name', 'formatted_address', 'formatted_phone_number', 'website'],
              },
              (place, detailStatus) => {
                if (detailStatus === google.maps.places.PlacesServiceStatus.OK && place) {
                  resolve(place);
                } else {
                  resolve(results[0]);
                }
              }
            );
          } else {
            resolve(results[0]);
          }
        } else {
          resolve(null);
        }
      }
    );
  });
}

export const VenueForm: React.FC<VenueFormProps> = ({ venue, onSave, onClose }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [mapsLink, setMapsLink] = useState('');
  const mapsInputRef = useRef<HTMLInputElement>(null);

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

  const handleMapsLinkPaste = useCallback(async (text: string) => {
    if (!isGoogleMapsUrl(text)) return;

    setMapsLink(text);
    const query = extractPlaceQuery(text);
    if (!query) {
      // Still set the link as the website
      if (!website) setWebsite(text);
      return;
    }

    setLookingUp(true);
    try {
      const place = await lookupPlace(query);
      if (place) {
        if (place.name && !name) setName(place.name);
        if (place.formatted_address && !address) setAddress(place.formatted_address);
        if ((place as any).formatted_phone_number && !contactPhone) {
          setContactPhone((place as any).formatted_phone_number);
        }
        if (place.website && !website) setWebsite(place.website);
        else if (!website) setWebsite(text);
      } else {
        // Couldn't look up, just fill what we can
        if (!name) setName(query);
        if (!website) setWebsite(text);
      }
    } catch {
      if (!name) setName(query);
      if (!website) setWebsite(text);
    }
    setLookingUp(false);
  }, [name, address, website, contactPhone]);

  const handleMapsInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setMapsLink(val);
    if (isGoogleMapsUrl(val)) {
      handleMapsLinkPaste(val);
    }
  };

  const handleMapsInputPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (isGoogleMapsUrl(text)) {
      e.preventDefault();
      handleMapsLinkPaste(text);
    }
  };

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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#1a1a2e] border border-white/10 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
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
          {/* Google Maps Link Quick-Fill */}
          {!venue && (
            <div className="relative">
              <Link size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              <input
                ref={mapsInputRef}
                type="text"
                value={mapsLink}
                onChange={handleMapsInputChange}
                onPaste={handleMapsInputPaste}
                placeholder="Paste a Google Maps link to auto-fill"
                className="w-full !pl-10 bg-white/5 border border-dashed border-white/20 rounded-xl text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-transparent py-2.5 pr-3 placeholder:text-white/30"
                autoFocus
              />
              {lookingUp && (
                <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-white/40" />
              )}
            </div>
          )}

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
              autoFocus={!!venue}
            />

            <IconInput
              icon={MapPin}
              iconSize={16}
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address"
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
