/**
 * Photo selection + timeline planning for sizzle reels (pure, unit-tested).
 */

export interface ReelPhotoCandidate {
  id: string;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  starred: boolean;
  voteCount: number;
  payoutRole: string | null;
  status: string;
  deletedAt: Date | null;
  createdAt: Date;
}

/** Only approved, non-deleted still images are eligible (videos are a later phase). */
export function isReelEligible(p: ReelPhotoCandidate): boolean {
  return (
    p.status === 'approved' &&
    !p.deletedAt &&
    !!p.url &&
    /^https?:\/\//i.test(p.url) &&
    p.mimeType.toLowerCase().startsWith('image/')
  );
}

/** starred desc, group photo first, votes desc, oldest first, id as a stable tiebreak. */
export function compareForReel(a: ReelPhotoCandidate, b: ReelPhotoCandidate): number {
  if (a.starred !== b.starred) return a.starred ? -1 : 1;
  const ag = a.payoutRole === 'group';
  const bg = b.payoutRole === 'group';
  if (ag !== bg) return ag ? -1 : 1;
  if (a.voteCount !== b.voteCount) return b.voteCount - a.voteCount;
  const t = a.createdAt.getTime() - b.createdAt.getTime();
  if (t !== 0) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Pick up to `max` photos. If the host chose specific photos (`pickedIds`) they
 * win, restricted to eligible ones. Otherwise rank by starred/group/votes. The
 * chosen set is then shown in chronological order so the reel tells the night
 * in order.
 */
export function selectReelPhotos(
  all: ReelPhotoCandidate[],
  max: number,
  pickedIds?: string[],
): ReelPhotoCandidate[] {
  const eligible = all.filter(isReelEligible);
  let chosen: ReelPhotoCandidate[];
  if (pickedIds && pickedIds.length) {
    const byId = new Map(eligible.map((p) => [p.id, p]));
    chosen = Array.from(new Set(pickedIds))
      .map((id) => byId.get(id))
      .filter((p): p is ReelPhotoCandidate => !!p)
      .slice(0, max);
  } else {
    chosen = [...eligible].sort(compareForReel).slice(0, max);
  }
  return chosen.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
}

export interface TimelineOptions {
  count: number;
  targetSeconds: number;
  maxSeconds: number;
  titleSeconds?: number;
  endSeconds?: number;
  transitionSeconds?: number;
  minItemSeconds?: number;
  maxItemSeconds?: number;
}

export interface Timeline {
  titleSeconds: number;
  endSeconds: number;
  itemSeconds: number;
  transitionSeconds: number;
  /** Total length of the final video, transition overlap accounted for. */
  totalSeconds: number;
}

/** Work out the per-photo duration so the whole reel lands on the target without exceeding the cap. */
export function planTimeline(o: TimelineOptions): Timeline {
  const titleSeconds = o.titleSeconds ?? 3;
  const endSeconds = o.endSeconds ?? 4;
  const t = o.transitionSeconds ?? 0.5;
  const minItem = o.minItemSeconds ?? 1.5;
  const maxItem = o.maxItemSeconds ?? 4;
  const n = Math.max(0, o.count);
  const segments = n + 2;
  // total = title + n*item + end - (segments-1)*t
  const fixed = titleSeconds + endSeconds - (segments - 1) * t;
  const goal = Math.min(o.targetSeconds, o.maxSeconds);
  let item = n > 0 ? (goal - fixed) / n : 0;
  item = Math.min(maxItem, Math.max(minItem, item));
  item = Math.round(item * 10) / 10;
  let total = fixed + n * item;
  // Never exceed the hard cap: shrink items below the soft minimum if we must.
  if (total > o.maxSeconds && n > 0) {
    item = Math.max(t + 0.5, Math.floor(((o.maxSeconds - fixed) / n) * 10) / 10);
    total = fixed + n * item;
  }
  return {
    titleSeconds,
    endSeconds,
    itemSeconds: item,
    transitionSeconds: t,
    totalSeconds: Math.round(total * 10) / 10,
  };
}

/** Photo URLs must come from our own storage origin (when configured). */
export function isAllowedPhotoUrl(url: string, storageOrigin?: string): boolean {
  if (!storageOrigin) return true;
  try {
    return new URL(url).origin === new URL(storageOrigin).origin;
  } catch {
    return false;
  }
}
