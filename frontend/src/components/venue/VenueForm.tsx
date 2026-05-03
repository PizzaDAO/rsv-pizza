import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { X, Loader2, MapPin, Users, DollarSign, User, Phone, Mail, Globe, FileText, Building2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Venue, VenueStatus } from '../../types';
import { VenueCreateData } from '../../lib/api';
import { IconInput } from '../IconInput';
import { LocationAutocomplete } from '../LocationAutocomplete';

interface VenueFormProps {
  venue?: Venue;
  onSave: (data: VenueCreateData) => Promise<void>;
  onClose: () => void;
}

const venueStatusOptions: { value: VenueStatus; labelKey: string }[] = [
  { value: 'researching', labelKey: 'venue.researching' },
  { value: 'contacted', labelKey: 'venue.contacted' },
  { value: 'negotiating', labelKey: 'venue.negotiating' },
  { value: 'confirmed', labelKey: 'venue.confirmedStatus' },
  { value: 'deposit_paid', labelKey: 'venue.depositPaid' },
  { value: 'paid_in_full', labelKey: 'venue.paidInFull' },
  { value: 'declined', labelKey: 'venue.declinedStatus' },
];

/** Fetch place details (website, phone) from a place_id */
function fetchPlaceDetails(placeId: string): Promise<google.maps.places.PlaceResult | null> {
  return new Promise((resolve) => {
    if (!window.google?.maps?.places) {
      resolve(null);
      return;
    }

    const div = document.createElement('div');
    const service = new google.maps.places.PlacesService(div);

    service.getDetails(
      {
        placeId,
        fields: ['name', 'formatted_address', 'formatted_phone_number', 'website'],
      },
      (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && place) {
          resolve(place);
        } else {
          resolve(null);
        }
      }
    );
  });
}

// ─── Simplified "Add Venue" modal ────────────────────────────────────────────
// Shows only a LocationAutocomplete search. When a place is picked, auto-creates
// the venue and closes the modal.

const AddVenueModal: React.FC<{ onSave: VenueFormProps['onSave']; onClose: VenueFormProps['onClose'] }> = ({ onSave, onClose }) => {
  const { t } = useTranslation('host');
  const [searchValue, setSearchValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePlaceSelected = useCallback(async (address: string, venueName: string | null) => {
    if (saving) return;

    const name = venueName || address;
    if (!name) return;

    setSaving(true);
    setError(null);

    // Try to fetch additional details (website, phone) via Places text search
    let website: string | undefined;
    let contactPhone: string | undefined;

    try {
      if (window.google?.maps?.places && venueName) {
        const searchQuery = venueName + (address ? ' ' + address : '');
        const details = await new Promise<google.maps.places.PlaceResult | null>((resolve) => {
          const div = document.createElement('div');
          const service = new google.maps.places.PlacesService(div);
          service.findPlaceFromQuery(
            {
              query: searchQuery,
              fields: ['place_id'],
            },
            (results, status) => {
              if (status === google.maps.places.PlacesServiceStatus.OK && results?.[0]?.place_id) {
                fetchPlaceDetails(results[0].place_id).then(resolve);
              } else {
                resolve(null);
              }
            }
          );
        });

        if (details) {
          website = details.website || undefined;
          contactPhone = (details as any).formatted_phone_number || undefined;
        }
      }
    } catch {
      // Non-critical — we'll create the venue without extra details
    }

    try {
      await onSave({
        name: name.trim(),
        address: address.trim() || undefined,
        website,
        contactPhone,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add venue');
      setSaving(false);
    }
  }, [saving, onSave, onClose]);

  return createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-theme-header border border-theme-stroke rounded-xl shadow-xl max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-theme-stroke">
          <div className="flex items-center gap-2">
            <MapPin size={20} className="text-[#ff393a]" />
            <h2 className="text-lg font-semibold text-theme-text">{t('venue.addVenueOption')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-theme-text-muted hover:text-theme-text transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {saving ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 size={24} className="animate-spin text-[#ff393a]" />
              <p className="text-sm text-theme-text-secondary">{t('venue.addingVenue')}</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-theme-text-secondary">
                {t('venue.searchVenueHint')}
              </p>
              <LocationAutocomplete
                value={searchValue}
                onChange={setSearchValue}
                onPlaceSelected={handlePlaceSelected}
                types={['establishment']}
                fields={['formatted_address', 'name', 'place_id', 'geometry', 'website']}
                placeholder={t('venue.searchForVenue')}
              />
            </>
          )}

          {error && (
            <div className="p-3 rounded-lg text-sm bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a]">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

// ─── Full edit form (existing venues) ────────────────────────────────────────

const EditVenueForm: React.FC<VenueFormProps> = ({ venue, onSave, onClose }) => {
  const { t } = useTranslation('host');
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
  const [pros, setPros] = useState(venue?.pros || '');
  const [cons, setCons] = useState(venue?.cons || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError(t('venue.venueNameError'));
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
        pros: pros.trim() || undefined,
        cons: cons.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save venue');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-theme-header border border-theme-stroke rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-theme-stroke">
          <div className="flex items-center gap-2">
            <MapPin size={20} className="text-[#ff393a]" />
            <h2 className="text-lg font-semibold text-theme-text">{t('venue.editVenue')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-theme-text-muted hover:text-theme-text transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Venue Info Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-theme-text-secondary">{t('venue.venueDetails')}</h3>

            <IconInput
              icon={MapPin}
              iconSize={16}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('venue.venueNameRequired')}
              autoFocus
            />

            <IconInput
              icon={MapPin}
              iconSize={16}
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t('venue.address')}
            />

            <div className="grid grid-cols-2 gap-3">
              <IconInput
                icon={Globe}
                iconSize={16}
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder={t('venue.websiteMapLink')}
              />
              <IconInput
                icon={Users}
                iconSize={16}
                type="number"
                min={0}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder={t('venue.capacity')}
              />
            </div>

            <IconInput
              icon={Building2}
              iconSize={16}
              type="text"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder={t('venue.organizationCompany')}
            />
          </div>

          {/* Status & Cost Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-theme-text-secondary">{t('venue.statusAndCost')}</h3>

            <div className="grid grid-cols-2 gap-3">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as VenueStatus)}
                className="w-full appearance-none cursor-pointer"
                style={{ colorScheme: 'dark' }}
              >
                {venueStatusOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-theme-header">
                    {t(option.labelKey)}
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
                placeholder={t('venue.cost')}
              />
            </div>

            <IconInput
              icon={User}
              iconSize={16}
              type="text"
              value={pointPerson}
              onChange={(e) => setPointPerson(e.target.value)}
              placeholder={t('venue.pointPersonTeam')}
            />
          </div>

          {/* Contact Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-theme-text-secondary">{t('venue.venueContactSection')}</h3>

            <IconInput
              icon={User}
              iconSize={16}
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder={t('venue.contactName')}
            />

            <div className="grid grid-cols-2 gap-3">
              <IconInput
                icon={Mail}
                iconSize={16}
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder={t('venue.contactEmail')}
              />
              <IconInput
                icon={Phone}
                iconSize={16}
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder={t('venue.contactPhone')}
              />
            </div>
          </div>

          {/* Pros & Cons Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-theme-text-secondary">{t('venue.prosAndCons')}</h3>
            <IconInput
              icon={ThumbsUp}
              iconSize={16}
              multiline
              rows={2}
              value={pros}
              onChange={(e) => setPros(e.target.value)}
              placeholder={t('venue.prosPlaceholder')}
            />
            <IconInput
              icon={ThumbsDown}
              iconSize={16}
              multiline
              rows={2}
              value={cons}
              onChange={(e) => setCons(e.target.value)}
              placeholder={t('venue.consPlaceholder')}
            />
          </div>

          {/* Notes Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-theme-text-secondary">{t('venue.notesSection')}</h3>
            <IconInput
              icon={FileText}
              iconSize={16}
              multiline
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('venue.notesPlaceholder')}
            />
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
              className="flex-1 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              {t('venue.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t('venue.saving')}
                </>
              ) : (
                t('venue.saveChanges')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

// ─── Exported component ──────────────────────────────────────────────────────
// Routes to simplified add modal vs full edit form based on whether a venue is provided.

export const VenueForm: React.FC<VenueFormProps> = (props) => {
  if (props.venue) {
    return <EditVenueForm {...props} />;
  }
  return <AddVenueModal onSave={props.onSave} onClose={props.onClose} />;
};
