import React, { useRef, useState } from 'react';
import { Video, Loader2, Film } from 'lucide-react';
import { Party } from '../../types';
import { uploadEventVideo } from '../../lib/supabase';
import { uploadPhoto as uploadPhotoApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

interface VideoQuickCaptureCardProps {
  party: Party;
  onUploaded?: () => void;
}

/**
 * pancetta-58112: Day-of one-tap video capture, mirroring PhotoQuickCaptureCard.
 * Two distinct buttons:
 *   - "Record a Video": opens the camera directly via `capture="environment"`
 *   - "Upload a video": opens the file picker (no capture attribute)
 *
 * Both buttons share the same `handleFile` upload pipeline. Backend
 * (`POST /api/parties/:partyId/photos`) already accepts video MIME types
 * and stores `duration`; gallery `Videos` sub-tab filters by mimeType.
 */
export const VideoQuickCaptureCard: React.FC<VideoQuickCaptureCardProps> = ({ party, onUploaded }) => {
  const { user } = useAuth();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    setUploading(true);
    setLastSuccess(false);
    try {
      const upload = await uploadEventVideo(file, party.id);
      if (!upload) {
        // uploadEventVideo console.errors the precise reason (type/size/duration);
        // surface a generic constraint hint here.
        throw new Error('Upload failed — check size (≤50MB) and length (≤5 min)');
      }
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
      });
      if (!res) throw new Error('Upload failed (api)');
      setLastSuccess(true);
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
    // Reset both inputs so the same file can be picked again from either source
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (libraryInputRef.current) libraryInputRef.current.value = '';
  };

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Video size={18} className="text-[#ff393a]" />
        <h3 className="text-lg font-semibold text-theme-text">Quick video</h3>
      </div>

      <button
        type="button"
        onClick={() => cameraInputRef.current?.click()}
        disabled={uploading}
        className="w-full bg-[#ff393a] text-white rounded-xl py-6 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {uploading ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <Video size={20} />
            Record a Video
          </>
        )}
      </button>

      <button
        type="button"
        onClick={() => libraryInputRef.current?.click()}
        disabled={uploading}
        className="w-full bg-theme-surface-hover text-theme-text rounded-xl py-3 font-medium flex items-center justify-center gap-2 disabled:opacity-50 border border-white/10 hover:bg-white/10 transition-colors"
      >
        <Film size={16} />
        Upload a video
      </button>

      <p className="text-xs text-white/40">≤50MB · ≤5 min · mp4 / webm / mov</p>

      <input
        ref={cameraInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={onSelected}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={onSelected}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}
      {lastSuccess && !uploading && (
        <p className="text-sm text-green-400">Uploaded — visible to guests on the event page.</p>
      )}
    </div>
  );
};
