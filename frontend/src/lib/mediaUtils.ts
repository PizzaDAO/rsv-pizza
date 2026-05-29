/**
 * melanzane-92103: shared helper for distinguishing video files from images
 * across the payments-admin and payouts thumbnail grids and the shared
 * ReceiptLightbox. Per bottarga-92103 the backend serializers now expose
 * `mimeType` and `fileName` on `payout_documents` and event `Photo` rows, so
 * we can detect video media by MIME prefix and fall back to a file-extension
 * sniff for older rows that may have a missing/incorrect MIME.
 */

const VIDEO_EXTS = ['.mp4', '.m4v', '.mov', '.webm', '.mkv'];

export function isVideoFile(item: {
  mimeType?: string | null;
  fileName?: string | null;
  url?: string | null;
}): boolean {
  if (item.mimeType && item.mimeType.toLowerCase().startsWith('video/')) return true;
  const path = (item.fileName || item.url || '').toLowerCase();
  return VIDEO_EXTS.some((ext) => path.endsWith(ext));
}
