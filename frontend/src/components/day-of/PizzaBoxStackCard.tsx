import React, { useEffect, useRef, useState } from 'react';
import { Boxes, Loader2, Check, Camera, ImagePlus } from 'lucide-react';
import { Party } from '../../types';
import { uploadEventPhoto } from '../../lib/supabase';
import { uploadPhoto as uploadPhotoApi, getPartyPhotos } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

interface PizzaBoxStackCardProps {
  party: Party;
  onUploaded?: () => void;
}

/**
 * GPP-only host prompt — encourages the host to build a tower with the
 * empty pizza boxes (PizzaDAO tradition) and snap a photo. Sibling
 * visibility gate is the responsibility of the caller (DayOfDashboard);
 * render-time check is a defensive fallback. Done-state is detected by
 * the existence of any party photo tagged 'Box Tower' (the existing
 * default photo tag from backend/src/routes/photo.routes.ts); the card
 * dims to 50% but keeps the upload buttons active (events often build
 * multiple towers).
 *
 * Two distinct buttons:
 *   - "Take a Photo": opens camera directly (`capture="environment"`)
 *   - "Upload from library": opens file picker (no capture attribute)
 * Both share the same `handleFile` upload pipeline.
 */
export const PizzaBoxStackCard: React.FC<PizzaBoxStackCardProps> = ({ party, onUploaded }) => {
  // ---- HOOKS (all above any early return) -------------------------------
  const { user } = useAuth();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasBoxTower, setHasBoxTower] = useState(false);

  const checkForBoxTower = React.useCallback(async () => {
    try {
      const res = await getPartyPhotos(party.id, { tag: 'Box Tower', limit: 1 });
      setHasBoxTower(!!res && res.photos.length > 0);
    } catch {
      /* ignore — best-effort done-state */
    }
  }, [party.id]);

  useEffect(() => {
    checkForBoxTower();
  }, [checkForBoxTower]);

  const handleFile = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const upload = await uploadEventPhoto(file, party.id);
      if (!upload) {
        throw new Error('Upload failed (storage)');
      }
      const res = await uploadPhotoApi(party.id, {
        url: upload.url,
        fileName: upload.fileName,
        fileSize: upload.fileSize,
        mimeType: upload.mimeType,
        width: upload.width,
        height: upload.height,
        uploaderName: user?.name || 'Host',
        uploaderEmail: user?.email || undefined,
        tags: ['Box Tower'],
      });
      if (!res) throw new Error('Upload failed (api)');
      setHasBoxTower(true);
      onUploaded?.();
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const onSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (libraryInputRef.current) libraryInputRef.current.value = '';
  };

  return (
    <div
      className={`card p-5 space-y-3 transition-opacity ${
        hasBoxTower ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Boxes size={18} className="text-[#ff393a]" />
          <h3 className="text-lg font-semibold text-theme-text">
            Stack the pizza boxes
          </h3>
        </div>
        {hasBoxTower && (
          <span className="inline-flex items-center gap-1 text-xs text-green-400">
            <Check size={14} />
            Box tower uploaded
          </span>
        )}
      </div>

      <p className="text-sm leading-relaxed text-theme-text-secondary">
        Build a tower with all the empty pizza boxes! It's a PizzaDAO
        tradition. Stack them as high as you can and snap a photo for the
        archive.
      </p>

      <button
        type="button"
        onClick={() => cameraInputRef.current?.click()}
        disabled={uploading}
        className="w-full bg-[#ff393a] text-white rounded-xl py-4 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {uploading ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <Camera size={18} />
            Take a Photo
          </>
        )}
      </button>

      <button
        type="button"
        onClick={() => libraryInputRef.current?.click()}
        disabled={uploading}
        className="w-full bg-theme-surface-hover text-theme-text rounded-xl py-3 font-medium flex items-center justify-center gap-2 disabled:opacity-50 border border-white/10 hover:bg-white/10 transition-colors"
      >
        <ImagePlus size={16} />
        Upload from library
      </button>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onSelected}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onSelected}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
};
