import React from 'react';
import { Play } from 'lucide-react';

interface MediaThumbProps {
  src: string;
  mimeType?: string | null;
  alt?: string;
  /** "thumb" = no autoplay, muted, play icon overlay (default). "full" = video has controls + autoPlay. */
  mode?: 'thumb' | 'full';
  className?: string;
  /** Force play-icon overlay size for thumb mode. */
  playIconSize?: number;
}

/**
 * Renders a media URL as <img> or <video> based on mimeType.
 * - mode="thumb": video shows poster frame + centered play-icon overlay (no controls).
 * - mode="full":  video shows controls + autoPlay (suitable for lightbox / modal).
 *
 * For non-video mimeTypes (or when mimeType is missing), renders <img>.
 *
 * salame-58198: shared component fixes broken video thumbnails site-wide. The
 * `photos` table holds both images and videos; surfaces that rendered raw
 * <img src={photo.url}> without checking mimeType produced the broken-image
 * placeholder for video rows (browsers can't decode an MP4 inside an <img>).
 */
export function MediaThumb({
  src, mimeType, alt = '', mode = 'thumb', className = '', playIconSize = 24,
}: MediaThumbProps) {
  const isVideo = mimeType?.startsWith('video/');

  if (isVideo) {
    if (mode === 'full') {
      return (
        <video src={src} controls autoPlay className={className} />
      );
    }
    // thumb mode: poster frame + play overlay
    return (
      <div className="relative w-full h-full">
        <video src={src} preload="metadata" muted className={className} />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 rounded-full p-3">
            <Play size={playIconSize} className="text-white fill-white" />
          </div>
        </div>
      </div>
    );
  }

  return <img src={src} alt={alt} loading="lazy" className={className} />;
}
