import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clapperboard, Download, Link as LinkIcon, Loader2, Share2 } from 'lucide-react';
import {
  fetchReels,
  isReelActive,
  makeReel,
  type ReelItem,
  type ReelsOverview,
} from '../../lib/reelsApi';

interface ReelMakerProps {
  partyId: string;
  defaultTitle?: string;
}

const POLL_MS = 5000;

const VARIANTS: Array<{ key: string; label: string }> = [
  { key: '9x16', label: 'Vertical with music' },
  { key: '9x16_nomusic', label: 'Vertical, no music' },
  { key: '16x9', label: 'Wide with music' },
  { key: '16x9_nomusic', label: 'Wide, no music' },
];

/** Host card: on-demand "Make a sizzle reel" with status, preview, download and share. */
export const ReelMaker: React.FC<ReelMakerProps> = ({ partyId, defaultTitle }) => {
  const [data, setData] = useState<ReelsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState(defaultTitle ?? '');
  const [musicKey, setMusicKey] = useState('auto');
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchReels(partyId));
      setError(null);
    } catch {
      setLoadFailed(true);
    }
  }, [partyId]);

  useEffect(() => {
    let cancelled = false;
    fetchReels(partyId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [partyId]);

  const active = !!data?.reels.some(isReelActive);
  useEffect(() => {
    if (!active) return;
    timer.current = setTimeout(() => void load(), POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, data, load]);

  const onMake = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await makeReel(partyId, { title: title.trim() || undefined, musicKey });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the reel');
    } finally {
      setSubmitting(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  const share = async (r: ReelItem, url: string) => {
    try {
      await navigator.share({ title: r.title ?? 'Our party reel', url });
    } catch {
      /* cancelled */
    }
  };

  // Feature off (404), not allowed (403) or failed to load: render nothing.
  if (!data || loadFailed) return null;

  const latestReady = data.reels.find((r) => r.status === 'ready' && r.outputs);
  const canMake = data.eligible && !active && data.photoCount >= data.minPhotos;

  return (
    <div className="card p-6 space-y-4" data-testid="reel-maker">
      <div className="flex items-center gap-2">
        <Clapperboard size={20} className="text-theme-accent" />
        <h3 className="text-lg font-semibold text-theme-text">Sizzle reel</h3>
      </div>
      <p className="text-sm text-theme-text-secondary">
        A ~30 second highlight video from your best photos, with Global Pizza Party title and end cards. Made on
        demand in vertical and wide, with and without music.
      </p>

      {!data.eligible && <p className="text-sm text-theme-text-muted">{data.reason}</p>}
      {data.eligible && data.photoCount < data.minPhotos && (
        <p className="text-sm text-theme-text-muted">
          Add at least {data.minPhotos} approved photos to make a reel (you have {data.photoCount}).
        </p>
      )}

      {data.eligible && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-theme-text-secondary">
            Title card name
            <input
              className="mt-1 w-full rounded-lg bg-theme-input border border-theme-stroke px-3 py-2 text-theme-text"
              value={title}
              maxLength={80}
              placeholder={defaultTitle}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="text-sm text-theme-text-secondary">
            Music
            <select
              className="mt-1 w-full rounded-lg bg-theme-input border border-theme-stroke px-3 py-2 text-theme-text"
              value={musicKey}
              onChange={(e) => setMusicKey(e.target.value)}
            >
              <option value="auto">Pick one for me</option>
              <option value="none">No music</option>
              {data.tracks.map((t) => (
                <option key={t.key} value={t.key}>{t.title}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <button className="btn-primary" disabled={!canMake || submitting} onClick={onMake}>
        {submitting || active ? (
          <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Making your reel</span>
        ) : latestReady ? 'Make another reel' : 'Make a sizzle reel'}
      </button>

      {error && <p className="text-sm text-theme-error" role="alert">{error}</p>}

      {data.reels.map((r) => (
        <div key={r.id} className="rounded-xl border border-theme-stroke p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-theme-text">{r.title ?? 'Reel'}{r.musicTitle ? ` · ${r.musicTitle}` : ''}</span>
            <span className="text-theme-text-muted">
              {r.status === 'queued' && 'Waiting in line'}
              {r.status === 'rendering' && `Rendering ${r.progress}%`}
              {r.status === 'ready' && 'Ready'}
              {r.status === 'failed' && 'Failed'}
            </span>
          </div>
          {isReelActive(r) && (
            <div className="h-2 rounded-full bg-theme-surface overflow-hidden">
              <div className="h-full bg-theme-accent transition-all" style={{ width: `${Math.max(5, r.progress)}%` }} />
            </div>
          )}
          {r.status === 'failed' && <p className="text-sm text-theme-error">{r.error}</p>}
          {r.status === 'ready' && r.outputs && (
            <div className="space-y-3">
              {(r.outputs['9x16'] || r.outputs['9x16_nomusic']) && (
                <video
                  className="max-h-[420px] rounded-lg bg-black"
                  controls
                  playsInline
                  preload="metadata"
                  poster={r.outputs.poster}
                  src={r.outputs['9x16'] ?? r.outputs['9x16_nomusic']}
                />
              )}
              <ul className="space-y-2">
                {VARIANTS.filter((v) => r.outputs?.[v.key]).map((v) => {
                  const url = r.outputs![v.key];
                  return (
                    <li key={v.key} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-theme-text-secondary w-40">{v.label}</span>
                      <a className="btn-secondary inline-flex items-center gap-1" href={url} download target="_blank" rel="noopener noreferrer">
                        <Download size={14} /> Download
                      </a>
                      <button className="btn-secondary inline-flex items-center gap-1" onClick={() => copy(url)}>
                        <LinkIcon size={14} /> {copied === url ? 'Copied' : 'Copy link'}
                      </button>
                      {typeof navigator !== 'undefined' && 'share' in navigator && (
                        <button className="btn-secondary inline-flex items-center gap-1" onClick={() => share(r, url)}>
                          <Share2 size={14} /> Share
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-theme-text-muted">
                Tip: the no-music versions are best for adding trending audio in Instagram or TikTok.
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
