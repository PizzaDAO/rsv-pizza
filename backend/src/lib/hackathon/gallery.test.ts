import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database.js', () => ({ prisma: {} }));

import { isGalleryOpen, galleryOpensAfter } from './galleryRules.js';
import { parseHackathonDisplayConfig, resolveDisplayMode, publicMembers, projectImagePaths, awardRank, sortProjects } from './gallery.js';
import { signImagePathsCached, _resetSignedUrlCache } from './signedUrlCache.js';

const H = '22222222-2222-4222-8222-222222222222';
const S = '55555555-5555-4555-8555-000000000001';
const now = new Date('2027-03-07T00:00:00Z');
const base = { publishedAt: new Date('2027-01-01'), disabledAt: null, submissionDeadline: new Date('2027-03-06T23:00:00Z'), resultsRevealedAt: null };

describe('isGalleryOpen', () => {
  it('hidden never opens', () => {
    expect(isGalleryOpen({ ...base, galleryVisibility: 'hidden', resultsRevealedAt: now }, now)).toBe(false);
  });
  it('after_deadline opens at the deadline (server time) or on reveal', () => {
    const h = { ...base, galleryVisibility: 'after_deadline' };
    expect(isGalleryOpen(h, new Date('2027-03-06T22:59:59Z'))).toBe(false);
    expect(isGalleryOpen(h, new Date('2027-03-06T23:00:00Z'))).toBe(true);
    expect(isGalleryOpen({ ...h, submissionDeadline: null }, now)).toBe(false);
    expect(isGalleryOpen({ ...h, submissionDeadline: null, resultsRevealedAt: now }, now)).toBe(true);
  });
  it('after_reveal opens on reveal only', () => {
    const h = { ...base, galleryVisibility: 'after_reveal' };
    expect(isGalleryOpen(h, now)).toBe(false);
    expect(isGalleryOpen({ ...h, resultsRevealedAt: now }, now)).toBe(true);
  });
  it('unpublished / disabled / unknown values never open', () => {
    expect(isGalleryOpen({ ...base, galleryVisibility: 'after_reveal', resultsRevealedAt: now, publishedAt: null }, now)).toBe(false);
    expect(isGalleryOpen({ ...base, galleryVisibility: 'after_reveal', resultsRevealedAt: now, disabledAt: now }, now)).toBe(false);
    expect(isGalleryOpen({ ...base, galleryVisibility: 'public', resultsRevealedAt: now }, now)).toBe(false);
    expect(isGalleryOpen(null, now)).toBe(false);
  });
  it('galleryOpensAfter', () => {
    expect(galleryOpensAfter({ ...base, galleryVisibility: 'after_deadline' })).toBe('deadline');
    expect(galleryOpensAfter({ ...base, galleryVisibility: 'after_deadline', submissionDeadline: null })).toBe('reveal');
    expect(galleryOpensAfter({ ...base, galleryVisibility: 'after_reveal' })).toBe('reveal');
    expect(galleryOpensAfter({ ...base, galleryVisibility: 'hidden' })).toBeNull();
  });
});

describe('display config', () => {
  it('parses + defaults + drops unknown keys', () => {
    expect(parseHackathonDisplayConfig(undefined)).toEqual({ mode: 'auto', showQr: true });
    expect(parseHackathonDisplayConfig({ mode: 'winners', showQr: false, x: 1, _physicalWidth: '55' })).toEqual({ mode: 'winners', showQr: false, _physicalWidth: '55' });
    expect(parseHackathonDisplayConfig({ _resolution: 'x'.repeat(41) })).toEqual({ mode: 'auto', showQr: true });
    expect(parseHackathonDisplayConfig([1, 2])).toEqual({ mode: 'auto', showQr: true });
  });
  it('rejects bad modes', () => {
    expect(() => parseHackathonDisplayConfig({ mode: 'scores' })).toThrow(/mode/);
    expect(() => parseHackathonDisplayConfig({ showQr: 1 })).toThrow(/showQr/);
  });
  it('auto mode: winners after reveal, gallery when open, else countdown', () => {
    expect(resolveDisplayMode('auto', { galleryOpen: true, revealed: true, projectCount: 3, winnerCount: 1 })).toBe('winners');
    expect(resolveDisplayMode('auto', { galleryOpen: true, revealed: true, projectCount: 3, winnerCount: 0 })).toBe('gallery');
    expect(resolveDisplayMode('auto', { galleryOpen: true, revealed: false, projectCount: 0, winnerCount: 0 })).toBe('countdown');
    expect(resolveDisplayMode('auto', { galleryOpen: false, revealed: false, projectCount: 0, winnerCount: 0 })).toBe('countdown');
    expect(resolveDisplayMode('gallery', { galleryOpen: false, revealed: false, projectCount: 0, winnerCount: 0 })).toBe('gallery');
  });
});

describe('serializer helpers', () => {
  it('publicMembers: show_on_gallery, real names only, https avatars only', () => {
    const s = {
      team: {
        members: [
          { showOnGallery: true, user: { name: ' Ada ', profilePictureUrl: 'https://x/a.png', email: 'ada@x.com' } },
          { showOnGallery: false, user: { name: 'Hidden', profilePictureUrl: null } },
          { showOnGallery: true, user: { name: null, email: 'nobody@x.com' }, guest: null },
          { showOnGallery: true, user: { name: 'me@x.com' } },
          { showOnGallery: true, user: { name: null, profilePictureUrl: 'http://x/b.png' }, guest: { name: 'Guesty' } },
        ],
      },
    };
    expect(publicMembers(s)).toEqual([{ name: 'Ada', avatarUrl: 'https://x/a.png' }, { name: 'Guesty', avatarUrl: null }]);
  });
  it('projectImagePaths: only final paths under the project prefix', () => {
    const own = `${H}/${S}/aaaaaaaa-aaaa-4aaa-8aaa-000000000001.png`;
    expect(projectImagePaths({
      id: S, hackathonId: H, coverPath: own,
      screenshotPaths: [`${H}/${S}/tmp/aaaaaaaa-aaaa-4aaa-8aaa-000000000002.png`, `${H}/55555555-5555-4555-8555-000000000009/aaaaaaaa-aaaa-4aaa-8aaa-000000000003.png`, '../../etc/passwd'],
    })).toEqual([own]);
  });
  it('sortProjects: best prize first (winners order from publicWinners), then name', () => {
    const items = [{ slug: 'a', name: 'b' }, { slug: 'b', name: 'a' }, { slug: 'c', name: 'c' }];
    const w = (projectSlug: string) => ({ prizeId: 'p', prizeName: 'P', prizeAmount: null, prizeKind: 'judged', trackId: null, trackName: null, place: 1, projectName: projectSlug, projectSlug, projectTagline: null, teamName: null });
    const rank = awardRank([w('c'), w('a'), w('c')]);
    expect(sortProjects(items, rank).map((c) => c.name)).toEqual(['c', 'b', 'a']);
  });
});

describe('signedUrlCache', () => {
  beforeEach(() => _resetSignedUrlCache());
  it('reuses a URL while >= 5 min of its 15 min TTL is left, then re-signs', async () => {
    const signer = vi.fn(async (paths: string[]) => Object.fromEntries(paths.map((p) => [p, `u:${p}:${signer.mock.calls.length}`])));
    const t0 = 1_000_000;
    expect(await signImagePathsCached(['a', 'b', 'a'], t0, signer)).toEqual({ a: 'u:a:1', b: 'u:b:1' });
    expect(signer).toHaveBeenLastCalledWith(['a', 'b']);
    expect(await signImagePathsCached(['a'], t0 + 9 * 60_000, signer)).toEqual({ a: 'u:a:1' });
    expect(signer).toHaveBeenCalledTimes(1);
    expect(await signImagePathsCached(['a', 'c'], t0 + 11 * 60_000, signer)).toEqual({ a: 'u:a:2', c: 'u:c:2' });
    expect(signer).toHaveBeenLastCalledWith(['a', 'c']);
  });
  it('does not cache failures', async () => {
    const signer = vi.fn(async () => ({}));
    expect(await signImagePathsCached(['a'], 0, signer)).toEqual({});
    await signImagePathsCached(['a'], 0, signer);
    expect(signer).toHaveBeenCalledTimes(2);
  });
});
