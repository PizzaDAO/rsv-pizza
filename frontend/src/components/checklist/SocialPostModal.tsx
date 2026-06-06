import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Megaphone, Copy, Check, Download, Loader2 } from 'lucide-react';
import { IconInput } from '../IconInput';
import { normalizeHandle } from '../ShareRSVP';
import { countryNameToFlag } from '../../utils/countryFlag';
import { getPartyPhotos } from '../../lib/api';
import type { Party, Photo } from '../../types';

interface SocialPostModalProps {
  open: boolean;
  onClose: () => void;
  party: Party;
}

// X (Twitter) icon — mirrors ShareRSVP's inline XIcon
const XIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

/**
 * Build the partner @tags string. MIRRORS the guest "share on X" logic from
 * RSVPPage.tsx (~lines 289-299) + ShareRSVP.tsx, adapted for the camelCase
 * `Party` object (hostProfile / coHosts / host.twitter / host.showOnEvent).
 */
function buildPartnerTags(party: Party): string {
  const rawHandles: string[] = [];
  if (party.hostProfile?.twitter) rawHandles.push(party.hostProfile.twitter);
  for (const host of party.coHosts ?? []) {
    if (host.twitter && host.showOnEvent !== false) rawHandles.push(host.twitter);
  }

  // Always start with Pizza_DAO, then dedupe case-insensitively, drop empties.
  const allHandles = ['Pizza_DAO', ...rawHandles];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of allHandles) {
    const normalized = normalizeHandle(raw);
    if (normalized && !seen.has(normalized.toLowerCase())) {
      seen.add(normalized.toLowerCase());
      unique.push(normalized);
    }
  }
  return unique.map((h) => `@${h}`).join(' ');
}

function partyCity(party: Party): string {
  if (party.city) return party.city;
  return party.name.replace(/^Global Pizza Party\s*/i, '').trim() || party.name;
}

// Picked at random each time the modal opens; host can edit before posting.
const RECAP_ADJECTIVES = [
  'great',
  'awesome',
  'a blast',
  'incredible',
  'epic',
  'unforgettable',
  'legendary',
  'delicious',
];

function buildDefaultText(party: Party): string {
  const flag = countryNameToFlag(party.country);
  const city = partyCity(party);
  const tags = buildPartnerTags(party);
  const adjective = RECAP_ADJECTIVES[Math.floor(Math.random() * RECAP_ADJECTIVES.length)];
  return (
    `${flag}\u{1F355}\u{1F973}\n` +
    `Bitcoin Pizza Day ${city} was ${adjective}!\n` +
    `\n` +
    `Thanks ${tags} for supporting the event. See you next year!`
  );
}

async function downloadImage(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  const blob = await res.blob();
  const obj = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = obj;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(obj);
}

export function SocialPostModal({ open, onClose, party }: SocialPostModalProps) {
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [copied, setCopied] = useState(false);

  const city = useMemo(() => partyCity(party), [party]);

  // Re-initialize the editable text whenever the modal (re)opens.
  useEffect(() => {
    if (open) {
      setText(buildDefaultText(party));
      setCopied(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, party.id]);

  // Fetch photos on open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingPhotos(true);
    getPartyPhotos(party.id, { limit: 24 })
      .then((res) => {
        if (cancelled) return;
        const items = (res?.photos ?? [])
          .filter((p) => p.status === 'approved' && p.mimeType?.startsWith('image/'))
          .sort((a, b) => Number(b.starred) - Number(a.starred));
        setPhotos(items);
        setLoadingPhotos(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPhotos([]);
        setLoadingPhotos(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, party.id]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const overLimit = text.length > 280;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // user can manually select
    }
  };

  const handlePostOnX = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener');
  };

  const slug = city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'party';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-theme-card border border-theme-stroke text-theme-text shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 text-theme-text-faint hover:text-theme-text transition-colors"
        >
          <X size={20} />
        </button>

        <h2 className="text-lg font-semibold text-theme-text flex items-center gap-2 mb-1 pr-8">
          <Megaphone size={18} />
          Post about the party on socials
        </h2>
        <p className="text-sm text-theme-text-muted mb-4">
          Share a recap and download your event photos to post.
        </p>

        {/* Editable post */}
        <IconInput
          icon={Megaphone}
          multiline
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write your recap post…"
        />
        <div
          className={`mt-1 mb-4 text-right text-xs ${
            overLimit ? 'text-red-500' : 'text-theme-text-faint'
          }`}
        >
          {text.length}/280
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mb-5">
          <button
            type="button"
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-theme-surface border border-theme-stroke hover:bg-theme-surface-hover transition-colors text-theme-text text-sm"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copied' : 'Copy to clipboard'}
          </button>
          <button
            type="button"
            onClick={handlePostOnX}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold text-sm"
          >
            <XIcon size={14} />
            Post on X
          </button>
        </div>

        {/* Photos */}
        <div>
          <h3 className="text-sm font-medium text-theme-text mb-2">Event photos</h3>
          {loadingPhotos ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" />
            </div>
          ) : photos.length === 0 ? (
            <p className="text-sm text-theme-text-muted py-4">No photos yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((photo, i) => (
                <div
                  key={photo.id}
                  className="relative group aspect-square rounded-lg overflow-hidden border border-theme-stroke"
                >
                  <img
                    src={photo.thumbnailUrl || photo.url}
                    alt={photo.caption || `Photo ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      downloadImage(photo.url, `${slug}-bpd-2026-${i + 1}.jpg`).catch(() => {})
                    }
                    aria-label="Download photo"
                    className="absolute bottom-1 right-1 w-7 h-7 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-black/80 transition-opacity"
                  >
                    <Download size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
