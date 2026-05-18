import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import { LocationAutocomplete } from '../LocationAutocomplete';
import { usePizza } from '../../contexts/PizzaContext';
import { updateParty } from '../../lib/supabase';
import { triggerFlyerRegen } from '../flyer/autoRegenFlyer';

interface FindVenueModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

export const FindVenueModal: React.FC<FindVenueModalProps> = ({ open, onClose, onSaved }) => {
  const { t } = useTranslation('host');
  const { party, loadParty } = usePizza();
  const [address, setAddress] = useState('');
  const [venueName, setVenueName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const pendingPlaceIdRef = useRef<string | null>(null);

  // Seed from current party when opening; reset when closing
  useEffect(() => {
    if (open && party) {
      setAddress(party.address ?? '');
      setVenueName(party.venueName ?? null);
      setError(null);
      pendingCoordsRef.current = null;
      pendingPlaceIdRef.current = null;
    }
    if (!open) {
      setAddress('');
      setVenueName(null);
      setError(null);
      pendingCoordsRef.current = null;
      pendingPlaceIdRef.current = null;
    }
  }, [open, party?.id, party?.address, party?.venueName]);

  if (!open || !party) return null;

  const handleSave = async () => {
    if (!address.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const success = await updateParty(party.id, {
        address: address.trim(),
        venue_name: venueName || null,
        // Only include coords if we actually got a fresh pick — don't null out existing coords on free-form text save
        ...(pendingCoordsRef.current ? {
          latitude: pendingCoordsRef.current.lat,
          longitude: pendingCoordsRef.current.lng,
        } : {}),
        ...(pendingPlaceIdRef.current ? { place_id: pendingPlaceIdRef.current } : {}),
      });
      if (!success) {
        setError(t('venue.findVenueSaveError'));
        return;
      }
      if (party.inviteCode) {
        await loadParty(party.inviteCode);
      }
      triggerFlyerRegen(party, loadParty);
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
          value={venueName ? `${venueName}, ${address}` : address}
          onChange={(v) => {
            setVenueName(null);
            setAddress(v);
            pendingCoordsRef.current = null;
            pendingPlaceIdRef.current = null;
          }}
          onVenueNameChange={setVenueName}
          onLocationSelected={(loc) => {
            pendingCoordsRef.current = loc;
          }}
          onPlaceSelected={(addr, vName, placeId) => {
            pendingPlaceIdRef.current = placeId;
            setAddress(addr);
            setVenueName(vName);
          }}
          placeholder={t('venue.findVenueModalPlaceholder')}
          disabled={saving}
        />

        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 btn-secondary"
          >
            {t('venue.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!address.trim() || saving}
            className="flex-1 btn-primary inline-flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {t('venue.findVenueModalCta')}
          </button>
        </div>
      </div>
    </div>
  );
};
