import React, { useEffect, useState } from 'react';
import { Loader2, ImageOff } from 'lucide-react';
import { getPartyPhotos } from '../../lib/api';
import { Photo } from '../../types';

interface ArtDisplayProps {
  partyId: string;
  /** ms per slide; default 8000. */
  intervalMs?: number;
}

/**
 * Full-bleed rotating slideshow of approved party photos. Designed for the
 * /display/:partyId/art route — a host pins this on a venue screen. Polls
 * every minute to pick up new photos.
 */
export const ArtDisplay: React.FC<ArtDisplayProps> = ({ partyId, intervalMs = 8000 }) => {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  // Initial fetch + polling refresh
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await getPartyPhotos(partyId, { status: 'approved', limit: 100 });
      if (cancelled) return;
      // Filter to images (skip videos — they don't loop cleanly in 8s)
      const images = (res?.photos || []).filter((p) => p.mimeType.startsWith('image/'));
      setPhotos(images);
      setLoading(false);
    };
    load();
    const handle = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [partyId]);

  // Rotation timer
  useEffect(() => {
    if (photos.length <= 1) return;
    const handle = setInterval(() => {
      setIndex((i) => (i + 1) % photos.length);
    }, intervalMs);
    return () => clearInterval(handle);
  }, [photos.length, intervalMs]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-white/40" />
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center text-white/50 gap-3">
        <ImageOff size={48} />
        <p>No approved photos yet.</p>
      </div>
    );
  }

  const current = photos[index];
  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center overflow-hidden">
      <img
        key={current.id}
        src={current.url}
        alt={current.caption || ''}
        className="max-w-full max-h-full object-contain animate-fadein"
      />
      <style>{`
        @keyframes fadein {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fadein {
          animation: fadein 800ms ease-out;
        }
      `}</style>
    </div>
  );
};
