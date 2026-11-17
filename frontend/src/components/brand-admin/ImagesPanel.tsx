import React, { useRef, useState } from 'react';
import { Upload, Trash2, Loader2, ImageOff } from 'lucide-react';
import { InlineConfirm } from '../InlineConfirm';
import { uploadBrandAsset, removeBrandAsset, type BrandAssetSlot, type BrandUploadStage } from '../../lib/seriesApi';
import { describeUploadError, describeApiError, precheckUpload, type BrandAssets } from '../../lib/brandAdminApi';

interface SlotInfo {
  slot: BrandAssetSlot;
  title: string;
  guide: string;
  /** Preview background: logos on dark chrome need a dark swatch, and the light logo a light one. */
  bg: 'checker' | 'dark' | 'light';
}

export const IMAGE_SLOTS: SlotInfo[] = [
  { slot: 'logo', title: 'Logo', guide: 'Shown in the header. Fits inside 1024×512. Transparent PNG works best.', bg: 'dark' },
  { slot: 'logoLight', title: 'Logo for light backgrounds', guide: 'Used where the page is light. Fits inside 1024×512.', bg: 'light' },
  { slot: 'favicon', title: 'Favicon', guide: 'Browser tab icon. Cropped to a 256×256 square.', bg: 'checker' },
  { slot: 'og', title: 'Social share image', guide: 'Link previews. Cropped to exactly 1200×630.', bg: 'checker' },
  { slot: 'flyerPoster', title: 'Flyer poster art', guide: 'Poster flyer artwork, cropped to 1080×1440.', bg: 'checker' },
  { slot: 'flyerRollup', title: 'Flyer roll-up art', guide: 'Roll-up banner artwork, cropped to 1080×2940.', bg: 'checker' },
];

const STAGE_LABEL: Record<BrandUploadStage, { text: string; pct: number }> = {
  preparing: { text: 'Preparing…', pct: 10 },
  uploading: { text: 'Uploading…', pct: 45 },
  processing: { text: 'Processing your image…', pct: 80 },
};

const BG_CLASS = {
  dark: 'bg-[#111]',
  light: 'bg-[#f4f4f5]',
  checker: 'bg-[#808080]/20',
};

interface Props {
  seriesId: string;
  assets: BrandAssets;
  /** Super-admins get the bundled /brands/ URLs too; everything is shown as stored. */
  onChanged: (slot: BrandAssetSlot, url: string | null) => void;
}

const SlotCard: React.FC<{ info: SlotInfo; seriesId: string; url: string | null; onChanged: Props['onChanged'] }> = ({ info, seriesId, url, onChanged }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<BrandUploadStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [imgBroken, setImgBroken] = useState(false);
  const busy = stage !== null || removing;

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so picking the same file again re-fires
    if (!file) return;
    setError(null);
    setNote(null);
    const pre = precheckUpload(file);
    if (pre) { setError(pre); return; }
    try {
      const res = await uploadBrandAsset(seriesId, info.slot, file, setStage);
      setImgBroken(false);
      onChanged(info.slot, res.url);
      setNote('Updated. It shows on your site within about a minute.');
    } catch (err) {
      setError(describeUploadError(err));
    } finally {
      setStage(null);
    }
  };

  const remove = async () => {
    setRemoving(true);
    setError(null);
    setNote(null);
    try {
      const res = await removeBrandAsset(seriesId, info.slot);
      onChanged(info.slot, res.url);
      setConfirming(false);
      setNote('Removed. The default is used again.');
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="card p-4 space-y-3 min-w-0" data-testid={`image-slot-${info.slot}`}>
      <div>
        <div className="text-sm font-semibold text-theme-text">{info.title}</div>
        <p className="text-xs text-theme-text-muted mt-0.5">{info.guide}</p>
      </div>

      <div className={`rounded-lg flex items-center justify-center h-32 overflow-hidden ${BG_CLASS[info.bg]}`}>
        {url && !imgBroken ? (
          <img src={url} alt={`${info.title} (current)`} className="max-h-full max-w-full object-contain" onError={() => setImgBroken(true)} />
        ) : (
          <div className="flex flex-col items-center gap-1 text-xs text-theme-text-muted">
            <ImageOff size={20} />
            <span>{url ? 'Could not load the image' : 'Using the default'}</span>
          </div>
        )}
      </div>

      {stage && (
        <div role="status" aria-live="polite">
          <div className="h-1.5 rounded-full bg-theme-stroke overflow-hidden">
            <div className="h-full bg-[#E52828] transition-all duration-500" style={{ width: `${STAGE_LABEL[stage].pct}%` }} />
          </div>
          <div className="text-xs text-theme-text-muted mt-1 flex items-center gap-1"><Loader2 size={12} className="animate-spin" />{STAGE_LABEL[stage].text}</div>
        </div>
      )}

      {confirming ? (
        <InlineConfirm
          message={`Remove this image and use the default ${info.title.toLowerCase()}?`}
          confirmLabel="Remove"
          cancelLabel="Keep it"
          busy={removing}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm inline-flex items-center gap-2 !px-3 !py-2 min-h-[40px] disabled:opacity-50" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload size={14} />{url ? 'Replace' : 'Upload'}
          </button>
          {url && (
            <button type="button" className="btn-secondary text-sm inline-flex items-center gap-2 !px-3 !py-2 min-h-[40px] disabled:opacity-50" disabled={busy} onClick={() => setConfirming(true)}>
              <Trash2 size={14} />Remove (use default)
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label={`Upload ${info.title}`} onChange={pick} />
        </div>
      )}

      {error && <p className="text-sm text-[#E52828]" role="alert">{error}</p>}
      {note && !error && <p className="text-xs text-theme-text-muted" role="status">{note}</p>}
    </div>
  );
};

export const ImagesPanel: React.FC<Props> = ({ seriesId, assets, onChanged }) => (
  <div className="space-y-4" data-testid="images-panel">
    <p className="text-sm text-theme-text-muted">
      PNG, JPEG or WebP up to 10 MB. We resize and clean every image for you (SVG and GIF are not accepted). Image changes
      can't be undone from History, so just upload the previous image again if you change your mind.
    </p>
    <div className="grid gap-4 sm:grid-cols-2">
      {IMAGE_SLOTS.map((info) => (
        <SlotCard key={info.slot} info={info} seriesId={seriesId} url={assets[info.slot] ?? null} onChanged={onChanged} />
      ))}
    </div>
  </div>
);
