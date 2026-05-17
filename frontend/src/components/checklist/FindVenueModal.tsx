import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import { LocationAutocomplete } from '../LocationAutocomplete';
import { usePizza } from '../../contexts/PizzaContext';
import { updateParty } from '../../lib/supabase';

interface FindVenueModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

export const FindVenueModal: React.FC<FindVenueModalProps> = ({ open, onClose, onSaved }) => {
  const { t } = useTranslation('host');
  const { party, loadParty } = usePizza();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  if (!open || !party) return null;

  const handlePlaceSelected = async (
    address: string,
    venueName: string | null,
    placeId: string | null,
  ) => {
    if (!party || saving) return;
    const coords = pendingCoordsRef.current;
    pendingCoordsRef.current = null;
    setSaving(true);
    setError(null);
    try {
      const success = await updateParty(party.id, {
        address: address.trim() || null,
        venue_name: venueName || null,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        ...(placeId ? { place_id: placeId } : {}),
      });
      if (!success) {
        setError(t('venue.findVenueSaveError'));
        return;
      }
      if (party.inviteCode) {
        await loadParty(party.inviteCode);
      }
      if (onSaved) {
        await onSaved();
      }
      onClose();
    } catch (err) {
      console.error('Failed to save venue address:', err);
      setError(t('venue.findVenueSaveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl p-6 w-full max-w-md relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('venue.cancel')}
          className="absolute right-4 top-4 text-theme-text-faint hover:text-theme-text transition-colors"
        >
          <X size={18} />
        </button>
        <h2 className="text-xl font-bold text-theme-text mb-2 pr-8">
          {t('venue.findVenueModalTitle')}
        </h2>
        <p className="text-sm text-theme-text-secondary mb-5">
          {t('venue.findVenueModalSubtitle')}
        </p>

        <LocationAutocomplete
          value=""
          onChange={() => { /* committed via onPlaceSelected */ }}
          onLocationSelected={(loc) => {
            pendingCoordsRef.current = loc;
          }}
          onPlaceSelected={(address, venueName, placeId) => {
            handlePlaceSelected(address, venueName, placeId);
          }}
          placeholder={t('venue.findVenueModalPlaceholder')}
          disabled={saving}
        />

        {saving && (
          <div className="flex items-center gap-2 text-sm text-theme-text-muted mt-4">
            <Loader2 size={14} className="animate-spin" />
            {t('venue.saving')}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-400 mt-3">{error}</p>
        )}

        <p className="text-xs text-theme-text-muted mt-5">
          {t('venue.findVenueModalCta')}
        </p>
      </div>
    </div>
  );
};
