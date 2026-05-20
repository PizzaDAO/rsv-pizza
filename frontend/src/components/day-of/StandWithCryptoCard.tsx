import React, { useEffect, useRef, useState } from 'react';
import { Shield, Loader2, Check, Camera, Video } from 'lucide-react';
import { Party } from '../../types';
import { uploadEventPhoto, uploadEventVideo } from '../../lib/supabase';
import { uploadPhoto as uploadPhotoApi, getPartyPhotos } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

interface StandWithCryptoCardProps {
  party: Party;
  onUploaded?: () => void;
}

type UploadState = {
  uploading: boolean;
  error: string | null;
};

/**
 * GPP-only Stand With Crypto sponsor activation. Two independent uploads:
 *   1. Group photo with SWC signs (tagged 'swc-photo', images bucket)
 *   2. Shoutout video (tagged 'swc-video', videos bucket)
 *
 * Each section shows a ✓ once its tagged file exists. Card dims to 50%
 * once BOTH are done; both upload buttons remain active throughout.
 *
 * Visibility gate (isGpp) is the caller's responsibility (DayOfDashboard).
 */
export const StandWithCryptoCard: React.FC<StandWithCryptoCardProps> = ({ party, onUploaded }) => {
  // ---- HOOKS (all above any early return) -------------------------------
  const { user } = useAuth();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const [photoState, setPhotoState] = useState<UploadState>({ uploading: false, error: null });
  const [videoState, setVideoState] = useState<UploadState>({ uploading: false, error: null });

  const [hasPhoto, setHasPhoto] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const [photoRes, videoRes] = await Promise.all([
        getPartyPhotos(party.id, { tag: 'swc-photo', limit: 1 }),
        getPartyPhotos(party.id, { tag: 'swc-video', limit: 1 }),
      ]);
      setHasPhoto(!!photoRes && photoRes.photos.length > 0);
      setHasVideo(!!videoRes && videoRes.photos.length > 0);
    } catch {
      /* ignore — best-effort done-state */
    }
  }, [party.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handlePhotoFile = async (file: File) => {
    setPhotoState({ uploading: true, error: null });
    try {
      const upload = await uploadEventPhoto(file, party.id);
      if (!upload) throw new Error('Upload failed (storage)');
      const res = await uploadPhotoApi(party.id, {
        url: upload.url,
        fileName: upload.fileName,
        fileSize: upload.fileSize,
        mimeType: upload.mimeType,
        width: upload.width,
        height: upload.height,
        uploaderName: user?.name || 'Host',
        uploaderEmail: user?.email || undefined,
        tags: ['swc-photo'],
      });
      if (!res) throw new Error('Upload failed (api)');
      setHasPhoto(true);
      onUploaded?.();
    } catch (err: any) {
      setPhotoState({ uploading: false, error: err?.message || 'Upload failed' });
      return;
    }
    setPhotoState({ uploading: false, error: null });
  };

  const handleVideoFile = async (file: File) => {
    setVideoState({ uploading: true, error: null });
    try {
      const upload = await uploadEventVideo(file, party.id);
      if (!upload) throw new Error('Upload failed (storage)');
      const res = await uploadPhotoApi(party.id, {
        url: upload.url,
        fileName: upload.fileName,
        fileSize: upload.fileSize,
        mimeType: upload.mimeType,
        width: upload.width,
        height: upload.height,
        duration: upload.duration,
        uploaderName: user?.name || 'Host',
        uploaderEmail: user?.email || undefined,
        tags: ['swc-video'],
      });
      if (!res) throw new Error('Upload failed (api)');
      setHasVideo(true);
      onUploaded?.();
    } catch (err: any) {
      setVideoState({ uploading: false, error: err?.message || 'Upload failed' });
      return;
    }
    setVideoState({ uploading: false, error: null });
  };

  const onPhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePhotoFile(file);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const onVideoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleVideoFile(file);
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  const bothDone = hasPhoto && hasVideo;

  return (
    <div
      className={`card p-5 space-y-4 transition-opacity ${
        bothDone ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <Shield size={18} className="text-[#ff393a]" />
        <h3 className="text-lg font-semibold text-theme-text">Stand With Crypto</h3>
      </div>

      <p className="text-sm leading-relaxed text-theme-text-secondary">
        Stand With Crypto is sponsoring GPP 2026. Help us deliver:
      </p>

      {/* Photo section ----------------------------------------------------- */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {hasPhoto ? (
            <Check size={16} className="text-green-400" />
          ) : (
            <span className="w-4 h-4" />
          )}
          <h4 className="text-sm font-semibold text-theme-text">
            Upload group photo with SWC signs
          </h4>
        </div>
        <p className="text-xs text-theme-text-muted">
          Get everyone in the shot holding the SWC signs.
        </p>
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          disabled={photoState.uploading}
          className="w-full bg-[#ff393a] text-white rounded-xl py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {photoState.uploading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <Camera size={16} />
              {hasPhoto ? 'Upload another group photo' : 'Upload group photo'}
            </>
          )}
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onPhotoSelected}
        />
        {photoState.error && <p className="text-xs text-red-400">{photoState.error}</p>}
      </div>

      {/* Video section ----------------------------------------------------- */}
      <div className="space-y-2 pt-2 border-t border-white/10">
        <div className="flex items-center gap-2">
          {hasVideo ? (
            <Check size={16} className="text-green-400" />
          ) : (
            <span className="w-4 h-4" />
          )}
          <h4 className="text-sm font-semibold text-theme-text">
            Upload SWC shoutout video
          </h4>
        </div>
        <p className="text-xs text-theme-text-muted">
          ~10–20 seconds of the crowd shouting "Stand With Crypto!" at the camera works great.
        </p>
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          disabled={videoState.uploading}
          className="w-full bg-[#ff393a] text-white rounded-xl py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {videoState.uploading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <Video size={16} />
              {hasVideo ? 'Upload another shoutout video' : 'Upload shoutout video'}
            </>
          )}
        </button>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          capture="environment"
          className="hidden"
          onChange={onVideoSelected}
        />
        {videoState.error && <p className="text-xs text-red-400">{videoState.error}</p>}
      </div>
    </div>
  );
};
