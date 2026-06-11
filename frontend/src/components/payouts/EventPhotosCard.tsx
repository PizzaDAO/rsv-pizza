import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Camera } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePizza } from '../../contexts/PizzaContext';
import { Photo } from '../../types';
import { designatePhotoRole, getPartyPhotos } from '../../lib/api';
import { RolePhotoPicker, PayoutPhotoRole } from './RolePhotoPicker';
import { PhotoUpload } from '../photos/PhotoUpload';
import { PhotoModal } from '../photos/PhotoModal';

const PAYOUT_ROLES: PayoutPhotoRole[] = ['group', 'box_stack', 'pizza'];

interface EventPhotosCardProps {
  partyId: string;
  /**
   * calzone-58297: reports whether all three role photos are designated.
   * The parent PayoutsTab uses this (together with receipt presence) to
   * unlock the PaymentDetailsCard.
   */
  onRolesChange?: (allDesignated: boolean) => void;
  /**
   * tiramisu-58530: fires whenever the gallery reloads (e.g. an additional
   * photo was uploaded) so the parent can refresh server readiness — which
   * now requires >=5 additional event photos beyond the 3 role photos.
   */
  onPhotosChange?: () => void;
}

/**
 * calzone-58297: event-level photo designation card. Hoisted out of
 * NewPayoutForm (porchetta-58296) so the three role photos (group / box stack
 * / pizza) are designated once per event, above the receipts area, and visible
 * in both the list and new-payout views.
 *
 * The designation is persisted per-photo via `designatePhotoRole` (writes
 * `photos.payout_role`). On mount we seed the slots from the gallery's
 * existing `payoutRole` values. The optional uploader adds extra gallery
 * photos with no role.
 */
export const EventPhotosCard: React.FC<EventPhotosCardProps> = ({
  partyId,
  onRolesChange,
  onPhotosChange,
}) => {
  const { t } = useTranslation('host');
  const { user } = useAuth();
  const { party } = usePizza();

  // porchetta-58296: the three host-designated event role photos. Each slot
  // holds the designated Photo (or undefined). Seeded on mount from the
  // gallery's payoutRole field. The actual designation is persisted via
  // designatePhotoRole when the host picks/uploads in the RolePhotoPicker.
  const [roles, setRoles] = useState<Record<PayoutPhotoRole, Photo | undefined>>({
    group: undefined,
    box_stack: undefined,
    pizza: undefined,
  });
  const [pickerRole, setPickerRole] = useState<PayoutPhotoRole | null>(null);
  const [designating, setDesignating] = useState(false);
  // stracciatella-58504: default the additional-photos uploader OPEN.
  const [showAdditionalUpload, setShowAdditionalUpload] = useState(true);
  // stracciatella-58504: full gallery list (seeds role slots + drives the
  // additional-photos preview below the uploader).
  const [galleryPhotos, setGalleryPhotos] = useState<Photo[]>([]);
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);

  // porchetta-58296 / stracciatella-58504: pull the gallery (host view), seed
  // the role slots from photos already carrying each payoutRole, AND keep the
  // full list for the additional-photos preview.
  const loadPhotos = useCallback(async () => {
    const photosRes = await getPartyPhotos(partyId, { status: 'all', limit: 100 });
    const photos = photosRes?.photos ?? [];
    const next: Record<PayoutPhotoRole, Photo | undefined> = {
      group: undefined,
      box_stack: undefined,
      pizza: undefined,
    };
    for (const p of photos) {
      if (p.payoutRole && PAYOUT_ROLES.includes(p.payoutRole as PayoutPhotoRole)) {
        next[p.payoutRole as PayoutPhotoRole] = p;
      }
    }
    setRoles(next);
    setGalleryPhotos(photos);
    // tiramisu-58530: tell the parent to refresh readiness whenever the gallery
    // reloads (covers additional-photo uploads, not just role designations).
    onPhotosChange?.();
  }, [partyId, onPhotosChange]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  // stracciatella-58504: additional photos = gallery photos NOT designated as
  // one of the three payout roles.
  const additionalPhotos = galleryPhotos.filter(
    p => !p.payoutRole || !PAYOUT_ROLES.includes(p.payoutRole as PayoutPhotoRole)
  );

  // tiramisu-58530: the 5-additional-photo requirement only counts photos dated
  // after the event start (party.date NULL ⇒ no cutoff), mirroring the backend
  // gate (getPayoutSubmissionReadiness) and the RolePhotoPicker cutoff. The
  // preview grid above still shows ALL additional photos; only this count drives
  // the progress line so it never reads "5 of 5" while the server still blocks.
  const cutoff = party?.date ? new Date(party.date).getTime() : null;
  const eligibleAdditionalCount = additionalPhotos.filter(
    p => cutoff == null || new Date(p.createdAt).getTime() >= cutoff
  ).length;

  // calzone-58297: report all-designated state to the parent whenever roles
  // change so PaymentDetailsCard can unlock.
  useEffect(() => {
    onRolesChange?.(!!roles.group && !!roles.box_stack && !!roles.pizza);
  }, [roles, onRolesChange]);

  // porchetta-58296: designate (persist) the chosen photo for the open slot.
  const handleRoleSelect = async (photo: Photo) => {
    if (!pickerRole) return;
    setDesignating(true);
    const updated = await designatePhotoRole(partyId, photo.id, pickerRole);
    setDesignating(false);
    if (updated) {
      setRoles(prev => ({ ...prev, [pickerRole]: updated }));
      setPickerRole(null);
    }
  };

  const roleLabels: Record<PayoutPhotoRole, string> = {
    group: t('payouts.roles.group'),
    box_stack: t('payouts.roles.boxStack'),
    pizza: t('payouts.roles.pizza'),
  };

  return (
    <div className="card p-6">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-theme-text">{t('payouts.eventPhotosTitle')}</h3>
        <p className="text-xs text-theme-text-muted mt-0.5">
          {t('payouts.eventPhotosSubtitle')}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {PAYOUT_ROLES.map(role => {
          const photo = roles[role];
          const isVideo = photo?.mimeType?.startsWith('video/');
          return (
            <button
              key={role}
              type="button"
              onClick={() => setPickerRole(role)}
              className="relative aspect-square rounded-xl overflow-hidden bg-theme-surface border border-theme-stroke hover:border-[#ff393a]/50 transition-colors text-left"
            >
              {photo ? (
                <>
                  {isVideo ? (
                    <video src={photo.url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                  ) : (
                    <img
                      src={photo.thumbnailUrl || photo.url}
                      alt={roleLabels[role]}
                      className="w-full h-full object-cover"
                    />
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <span className="text-xs font-medium text-white">{roleLabels[role]}</span>
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3 text-center">
                  <ImagePlus size={24} className="text-theme-text-muted" />
                  <span className="text-xs font-medium text-theme-text">{roleLabels[role]}</span>
                  <span className="text-[11px] text-theme-text-muted">{t('payouts.selectOrUpload')}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Optional additional photos — gallery upload, no role. */}
      <div className="mt-4">
        {/* tiramisu-58530: progress toward the 5 required additional photos. */}
        <div
          className={`text-xs mb-2 ${
            eligibleAdditionalCount >= 5 ? 'text-emerald-500' : 'text-theme-text-muted'
          }`}
        >
          {t('payouts.additionalPhotosProgress', { count: eligibleAdditionalCount, required: 5 })}
        </div>
        {/* stracciatella-58504: preview of already-uploaded additional photos. */}
        {additionalPhotos.length > 0 && (
          <div className="mb-3">
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {additionalPhotos.slice(0, 6).map(p => {
                const isVideo = p.mimeType?.startsWith('video/');
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setLightboxPhoto(p)}
                    className="aspect-square rounded-lg overflow-hidden bg-theme-surface border border-theme-stroke hover:border-[#ff393a]/50 transition-colors"
                  >
                    {isVideo ? (
                      <video src={p.url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                    ) : (
                      <img
                        src={p.thumbnailUrl || p.url}
                        alt={p.caption || 'Event photo'}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setLightboxPhoto(additionalPhotos[0])}
              className="mt-2 text-sm text-theme-text-secondary hover:text-[#ff393a] transition-colors"
            >
              {t('payouts.viewAllPhotos', { count: additionalPhotos.length })}
            </button>
          </div>
        )}

        {showAdditionalUpload ? (
          <PhotoUpload
            partyId={partyId}
            isHost
            uploaderName={user?.name ?? undefined}
            uploaderEmail={user?.email ?? undefined}
            onUploadComplete={() => loadPhotos()}
            onClose={() => setShowAdditionalUpload(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowAdditionalUpload(true)}
            className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text transition-colors"
          >
            <Camera size={16} />
            {t('payouts.additionalPhotos')}
          </button>
        )}
      </div>

      {/* porchetta-58296: role photo picker modal (select existing or upload). */}
      {pickerRole && (
        <RolePhotoPicker
          partyId={partyId}
          role={pickerRole}
          roleLabel={roleLabels[pickerRole]}
          eventStart={party?.date ?? null}
          selectedPhotoId={roles[pickerRole]?.id ?? null}
          onSelect={designating ? () => {} : handleRoleSelect}
          onClose={() => setPickerRole(null)}
        />
      )}

      {/* stracciatella-58504: read-only lightbox for additional photos. */}
      {lightboxPhoto && (
        <PhotoModal
          photo={lightboxPhoto}
          photos={additionalPhotos}
          isHost
          onClose={() => setLightboxPhoto(null)}
          onNavigate={setLightboxPhoto}
        />
      )}
    </div>
  );
};
