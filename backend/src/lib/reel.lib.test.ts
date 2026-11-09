import { describe, it, expect } from 'vitest';
import { selectReelPhotos, planTimeline, type ReelPhotoCandidate } from './reelSelection.js';
import { checkReelPermission } from './reelPermissions.js';
import { normalizeReelSettings, DEFAULT_REEL_SETTINGS } from './reelConfig.js';
import { filterEligibleTracks, isSafeTrackKey, pickAutoTrack, trackFromKey } from './reelMusic.js';
import { buildReelSpec, cleanTitle, formatReelDate } from './reelSpec.js';

let n = 0;
function photo(over: Partial<ReelPhotoCandidate> = {}): ReelPhotoCandidate {
  n++;
  return {
    id: `p${String(n).padStart(3, '0')}`,
    url: `https://example.com/p${n}.jpg`,
    mimeType: 'image/jpeg',
    width: 1000,
    height: 800,
    starred: false,
    voteCount: 0,
    payoutRole: null,
    status: 'approved',
    deletedAt: null,
    createdAt: new Date(2026, 4, 22, 18, n),
    ...over,
  };
}

describe('selectReelPhotos', () => {
  it('drops unapproved, deleted, video and non-http items', () => {
    const ok = photo();
    const all = [
      ok,
      photo({ status: 'pending' }),
      photo({ status: 'rejected' }),
      photo({ deletedAt: new Date() }),
      photo({ mimeType: 'video/mp4' }),
      photo({ url: 'ftp://example.com/x.jpg' }),
    ];
    expect(selectReelPhotos(all, 10).map((p) => p.id)).toEqual([ok.id]);
  });

  it('ranks starred, then group, then votes, then oldest when capping', () => {
    const plain = photo();
    const voted = photo({ voteCount: 5 });
    const group = photo({ payoutRole: 'group' });
    const starred = photo({ starred: true });
    const picked = selectReelPhotos([plain, voted, group, starred], 3);
    expect(picked.map((p) => p.id).sort()).toEqual([starred.id, group.id, voted.id].sort());
    expect(picked.find((p) => p.id === plain.id)).toBeUndefined();
  });

  it('returns the chosen photos in chronological order', () => {
    const a = photo({ starred: true, createdAt: new Date(2026, 4, 22, 21) });
    const b = photo({ starred: true, createdAt: new Date(2026, 4, 22, 19) });
    expect(selectReelPhotos([a, b], 5).map((p) => p.id)).toEqual([b.id, a.id]);
  });

  it('honours host picks but never includes ineligible ones', () => {
    const a = photo();
    const b = photo({ starred: true });
    const bad = photo({ status: 'pending' });
    const picked = selectReelPhotos([a, b, bad], 10, [a.id, bad.id, 'missing']);
    expect(picked.map((p) => p.id)).toEqual([a.id]);
  });

  it('caps at max', () => {
    const many = Array.from({ length: 30 }, () => photo());
    expect(selectReelPhotos(many, 14)).toHaveLength(14);
  });
});

describe('planTimeline', () => {
  it('lands near the 30s target for 14 photos', () => {
    const t = planTimeline({ count: 14, targetSeconds: 30, maxSeconds: 60 });
    expect(t.totalSeconds).toBeGreaterThan(24);
    expect(t.totalSeconds).toBeLessThanOrEqual(34);
  });
  it('never exceeds maxSeconds', () => {
    const t = planTimeline({ count: 14, targetSeconds: 60, maxSeconds: 20 });
    expect(t.totalSeconds).toBeLessThanOrEqual(20);
  });
  it('caps per-photo time for few photos', () => {
    const t = planTimeline({ count: 3, targetSeconds: 30, maxSeconds: 60 });
    expect(t.itemSeconds).toBeLessThanOrEqual(4);
  });
});

describe('checkReelPermission', () => {
  const past = new Date('2026-05-22T00:00:00Z');
  const now = new Date('2026-06-01T00:00:00Z');
  const base = { canEdit: true, isAdmin: false, partyDate: past, cancelledAt: null, now };
  it('allows hosts after the event', () => {
    expect(checkReelPermission(base).ok).toBe(true);
  });
  it('blocks non-editors', () => {
    const r = checkReelPermission({ ...base, canEdit: false });
    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
  it('blocks hosts before the event, but not admins', () => {
    const future = new Date('2026-07-01T00:00:00Z');
    expect(checkReelPermission({ ...base, partyDate: future })).toMatchObject({ ok: false, code: 'EVENT_NOT_HAPPENED' });
    expect(checkReelPermission({ ...base, partyDate: future, canEdit: false, isAdmin: true }).ok).toBe(true);
  });
  it('blocks events with no date and cancelled events for hosts', () => {
    expect(checkReelPermission({ ...base, partyDate: null }).ok).toBe(false);
    expect(checkReelPermission({ ...base, cancelledAt: now })).toMatchObject({ code: 'CANCELLED' });
  });
});

describe('normalizeReelSettings', () => {
  it('returns defaults for junk', () => {
    expect(normalizeReelSettings(null)).toEqual(DEFAULT_REEL_SETTINGS);
    expect(normalizeReelSettings('x')).toEqual(DEFAULT_REEL_SETTINGS);
  });
  it('clamps values and keeps target under max', () => {
    const s = normalizeReelSettings({ maxSeconds: 9999, targetSeconds: 500, maxPhotos: 1000, perUserDailyLimit: -3 });
    expect(s.maxSeconds).toBe(60);
    expect(s.targetSeconds).toBeLessThanOrEqual(s.maxSeconds);
    expect(s.maxPhotos).toBe(30);
    expect(s.perUserDailyLimit).toBe(1);
  });
  it('rejects bad colors and cleans folder lists', () => {
    const s = normalizeReelSettings({ brand: { red: 'javascript:1', sky: '#112233' }, musicFolders: ['/house/', 'house', ' ', 5] });
    expect(s.brand.red).toBe(DEFAULT_REEL_SETTINGS.brand.red);
    expect(s.brand.sky).toBe('#112233');
    expect(s.musicFolders).toEqual(['house']);
  });
});

describe('reelMusic', () => {
  const keys = [
    'songs/house-band/Pizza_Time.mp3',
    'songs/house-band/Slice.wav',
    'songs/other/Nope.mp3',
    'songs/house-band/readme.txt',
    'songs/../secret.mp3',
    'other/x.mp3',
  ];
  it('validates keys', () => {
    expect(isSafeTrackKey('songs/a/b.mp3')).toBe(true);
    expect(isSafeTrackKey('songs/../b.mp3')).toBe(false);
    expect(isSafeTrackKey('x/b.mp3')).toBe(false);
    expect(isSafeTrackKey('songs/a/b.txt')).toBe(false);
    expect(isSafeTrackKey(5)).toBe(false);
  });
  it('offers nothing with no config', () => {
    expect(filterEligibleTracks(keys, { musicFolders: [], allowedTracks: [], blockedTracks: [] })).toEqual([]);
  });
  it('filters by folder and block list', () => {
    const t = filterEligibleTracks(keys, {
      musicFolders: ['house-band'],
      allowedTracks: [],
      blockedTracks: ['songs/house-band/Slice.wav'],
    });
    expect(t.map((x) => x.key)).toEqual(['songs/house-band/Pizza_Time.mp3']);
    expect(t[0].title).toBe('Pizza Time');
  });
  it('allow-list works without folders', () => {
    const t = filterEligibleTracks(keys, { musicFolders: [], allowedTracks: ['songs/other/Nope.mp3'], blockedTracks: [] });
    expect(t.map((x) => x.key)).toEqual(['songs/other/Nope.mp3']);
  });
  it('auto pick is deterministic', () => {
    const tracks = keys.filter(isSafeTrackKey).map(trackFromKey);
    expect(pickAutoTrack(tracks, 'abc')).toEqual(pickAutoTrack(tracks, 'abc'));
    expect(pickAutoTrack([], 'abc')).toBeNull();
  });
});

describe('buildReelSpec', () => {
  const settings = DEFAULT_REEL_SETTINGS;
  it('builds a self-contained spec and drops unusable sponsor logos', () => {
    const spec = buildReelSpec({
      reelId: 'r1',
      partyId: 'pty',
      title: 'Slice Night',
      city: ' Austin ',
      date: new Date('2026-05-22T23:00:00Z'),
      timezone: 'America/Chicago',
      guestCount: 42,
      siteDomain: 'example.com',
      photos: [{ id: 'a', url: 'https://example.com/a.jpg' }],
      sponsors: [
        { id: 's1', name: 'A', logoUrl: 'https://example.com/a.svg' },
        { id: 's2', name: 'B', logoUrl: null },
        { id: 's3', name: 'C', logoUrl: 'javascript:alert(1)' },
      ],
      gppLogoUrl: null,
      music: null,
      settings,
    });
    expect(spec.city).toBe('Austin');
    expect(spec.dateLabel).toBe('May 22, 2026');
    expect(spec.sponsors.map((s) => s.id)).toEqual(['s1']);
    expect(spec.outputPrefix).toBe('reels/pty/r1');
    expect(spec.ratios).toEqual(['9x16', '16x9']);
    expect(spec.music).toBeNull();
  });
  it('formats dates in the party timezone and survives a bad one', () => {
    const d = new Date('2026-05-23T02:00:00Z');
    expect(formatReelDate(d, 'America/Los_Angeles')).toBe('May 22, 2026');
    expect(formatReelDate(d, 'Not/AZone')).toBe('May 23, 2026');
    expect(formatReelDate(null)).toBeNull();
  });
  it('cleans titles', () => {
    expect(cleanTitle('  a   b ', 'x')).toBe('a b');
    expect(cleanTitle('', 'Fallback')).toBe('Fallback');
    expect(cleanTitle(5, 'Fallback')).toBe('Fallback');
  });
});
