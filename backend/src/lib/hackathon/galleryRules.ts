/**
 * Gallery visibility rules (PR 6). Pure, so serialize.ts can use them without the gallery
 * loaders. Documented in gallery.ts.
 */

export interface GalleryRuleFields {
  publishedAt: Date | null;
  disabledAt: Date | null;
  galleryVisibility: string;
  submissionDeadline: Date | null;
  resultsRevealedAt: Date | null;
}

export function isGalleryOpen(h: GalleryRuleFields | null | undefined, now = new Date()): boolean {
  if (!h || !h.publishedAt || h.disabledAt) return false;
  switch (h.galleryVisibility) {
    case 'after_deadline':
      return !!h.resultsRevealedAt || (!!h.submissionDeadline && now.getTime() >= new Date(h.submissionDeadline).getTime());
    case 'after_reveal':
      return !!h.resultsRevealedAt;
    default:
      return false; // 'hidden' and anything unexpected
  }
}

/** What a closed gallery is waiting for (shown as "Projects appear after ..."). */
export function galleryOpensAfter(h: GalleryRuleFields): 'deadline' | 'reveal' | null {
  if (!h.publishedAt || h.disabledAt) return null;
  if (h.galleryVisibility === 'after_deadline') return h.submissionDeadline ? 'deadline' : 'reveal';
  if (h.galleryVisibility === 'after_reveal') return 'reveal';
  return null;
}

