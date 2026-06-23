import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Upload, Loader2, Check } from 'lucide-react';
import { Photo } from '../../types';
import { getPartyPhotos, uploadPhoto as uploadPhotoApi, PhotoUploadData } from '../../lib/api';
import { uploadEventPhoto } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

export type PayoutPhotoRole = 'group' | 'box_stack' | 'pizza';

interface RolePhotoPickerProps {
  partyId: string;
  /** Which role we're picking a photo for (used for the title). */
  role: PayoutPhotoRole;
  /** Human label for the role (already localized by the parent). */
  roleLabel: string;
  /**
   * Event start (parties.date, ISO string) or null. Photos dated before this
   * are ineligible (shown disabled). Null ⇒ no cutoff (mirrors backend).
   */
  eventStart: string | null;
  /** Currently-designated photo id for this role (highlighted in the grid). */
  selectedPhotoId?: string | null;
  /** Called with the chosen photo once it's been designated. */
  onSelect: (photo: Photo) => void;
  onClose: () => void;
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif'];

/**
 * porchetta-58296: modal grid of the event's gallery photos for designating a
 * payout role photo. The host either selects an existing (eligible) gallery
 * photo or uploads a new one straight into the gallery. The actual
 * `designatePhotoRole` PATCH is performed by the parent in `onSelect`.
 */
export const RolePhotoPicker: React.FC<RolePhotoPickerProps> = ({
  partyId,
  role,
  roleLabel,
  eventStart,
  selectedPhotoId,
  onSelect,
  onClose,
}) => {
  const { t } = useTranslation('host');
  const { user } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cutoff = eventStart ? new Date(eventStart).getTime() : null;
  const isEligible = useCallback(
    (p: Photo) => cutoff == null || new Date(p.createdAt).getTime() >= cutoff,
    [cutoff]
  );

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    // Host context: show all (approved/pending) photos so guest uploads awaiting
    // moderation are still pickable.
    const res = await getPartyPhotos(partyId, { status: 'all', limit: 100 });
    setPhotos(res?.photos ?? []);
    setLoading(false);
  }, [partyId]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        setUploadError(t('payouts.rolePicker.invalidType'));
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        setUploadError(t('payouts.rolePicker.tooLarge'));
        return;
      }
      setUploadError(null);
      setUploading(true);
      try {
        const uploadResult = await uploadEventPhoto(file, partyId);
        if (!uploadResult) {
          throw new Error(t('payouts.rolePicker.uploadFailed'));
        }
        const photoData: PhotoUploadData = {
          url: uploadResult.url,
          fileName: uploadResult.fileName,
          fileSize: uploadResult.fileSize,
          mimeType: uploadResult.mimeType,
          width: uploadResult.width,
          height: uploadResult.height,
          uploaderName: user?.name ?? undefined,
          uploaderEmail: user?.email ?? undefined,
        };
        const created = await uploadPhotoApi(partyId, photoData);
        if (!created) {
          throw new Error(t('payouts.rolePicker.uploadFailed'));
        }
        // Newly uploaded host photos are auto-approved + always eligible
        // (uploaded after the event), so designate immediately.
        onSelect(created.photo);
      } catch (err: any) {
        setUploadError(err?.message || t('payouts.rolePicker.uploadFailed'));
      } finally {
        setUploading(false);
      }
    },
    [partyId, user, onSelect, t]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-theme-stroke">
          <div>
            <h3 className="text-base font-semibold text-theme-text">
              {t('payouts.rolePicker.title', { role: roleLabel })}
            </h3>
            <p className="text-xs text-theme-text-muted mt-0.5">
              {t('payouts.rolePicker.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-theme-text-secondary hover:text-theme-text transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Upload action */}
        <div className="p-5 border-b border-theme-stroke">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/avif,video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {uploading ? t('payouts.rolePicker.uploading') : t('payouts.rolePicker.uploadNew')}
          </button>
          {uploadError && (
            <p className="text-xs text-red-400 mt-2">{uploadError}</p>
          )}
        </div>

        {/* Gallery grid */}
        <div className="p-5 overflow-y-auto">
          <p className="text-xs text-theme-text-muted mb-3">
            {t('payouts.rolePicker.selectFromGallery')}
          </p>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-theme-text-muted">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : photos.length === 0 ? (
            <p className="text-sm text-theme-text-muted py-6 text-center">
              {t('payouts.rolePicker.empty')}
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {photos.map((p) => {
                const eligible = isEligible(p);
                const isSelected = p.id === selectedPhotoId;
                const isVideo = p.mimeType?.startsWith('video/');
                return (
                  <div key={p.id} className="relative">
                    <button
                      type="button"
                      disabled={!eligible}
                      onClick={() => eligible && onSelect(p)}
                      className={`group relative aspect-square w-full rounded-lg overflow-hidden bg-theme-surface ${
                        eligible ? 'cursor-pointer' : 'cursor-not-allowed opacity-40 grayscale'
                      } ${isSelected ? 'ring-2 ring-[#ff393a]' : ''}`}
                      title={eligible ? undefined : t('payouts.rolePicker.ineligibleNote')}
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
                      {isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <div className="bg-[#ff393a] rounded-full p-1.5">
                            <Check size={16} className="text-white" />
                          </div>
                        </div>
                      )}
                    </button>
                    {!eligible && (
                      <p className="text-[10px] text-theme-text-muted mt-1 leading-tight">
                        {t('payouts.rolePicker.ineligibleNote')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
