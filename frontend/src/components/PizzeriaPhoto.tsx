import { useState } from 'react';
import type { PizzeriaPhoto as PizzeriaPhotoType } from '../types';
import pizzaPlaceholder from '../assets/pizza-placeholder.svg';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string || '').trim();

interface PizzeriaPhotoProps {
  photo: PizzeriaPhotoType | undefined;
  pizzeriaName: string;
  className?: string;
}

/**
 * Renders the first available photo for a pizzeria, with graceful fallback
 * to a static SVG placeholder.
 *
 * Precedence:
 *   1. `photo.source === 'host-upload'` → render `photo.name` as a direct URL
 *      (Supabase storage public URL). Reserved for v2 — v1 never emits this.
 *   2. `photo.source === 'google'` + looks like a Places resource name →
 *      render via `pizzeria-photo` edge function proxy. Shows the author
 *      attribution in tiny text below the image (Google ToS compliance).
 *   3. `photo.source === 'google'` + already a URL (legacy Autocomplete) →
 *      render directly. These URLs expire; on failure we fall through.
 *   4. Fallback → SVG placeholder.
 *
 * Loads lazily and degrades to the SVG placeholder if the image 404s (stale
 * Google photo name, expired pre-resolved URL, network error, etc).
 */
export function PizzeriaPhoto({ photo, pizzeriaName, className = '' }: PizzeriaPhotoProps) {
  const [errored, setErrored] = useState(false);

  const isPlacesResourceName =
    !!photo &&
    photo.source === 'google' &&
    /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(photo.name);

  const showFallback = !photo || errored || (photo.source === 'google' && !SUPABASE_URL && isPlacesResourceName);

  if (showFallback) {
    return (
      <img
        src={pizzaPlaceholder}
        alt={pizzeriaName}
        aria-hidden={false}
        className={className}
        loading="lazy"
      />
    );
  }

  let src: string;
  if (isPlacesResourceName) {
    src = `${SUPABASE_URL}/functions/v1/pizzeria-photo?name=${encodeURIComponent(photo!.name)}&maxWidthPx=400&maxHeightPx=400`;
  } else {
    // host-upload URL or pre-resolved legacy Autocomplete URL — render directly.
    src = photo!.name;
  }

  const attribution =
    photo && photo.source === 'google' && photo.authorAttribution
      ? photo.authorAttribution
      : null;

  return (
    <>
      <img
        src={src}
        alt={pizzeriaName}
        loading="lazy"
        className={className}
        onError={() => setErrored(true)}
      />
      {attribution && (
        <p className="text-[10px] text-white/40 mt-1 leading-tight truncate">
          Photo:{' '}
          <a
            href={attribution.uri}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-white/60"
          >
            {attribution.displayName}
          </a>
        </p>
      )}
    </>
  );
}

export default PizzeriaPhoto;
