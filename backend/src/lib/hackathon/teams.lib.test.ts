/**
 * Hackathon PR 3 pure helpers: eligibility, project URLs, invite codes, slugs, CSV escaping,
 * media path scoping + sniffing, and the team/host serializers' privacy.
 */
import { describe, it, expect } from 'vitest';
import { decideEligibility, type GuestLike } from './eligibility.js';
import { normalizeProjectUrl } from './urls.js';
import { generateInviteCode, normalizeInviteCode, pickSlug, slugify, SLUG_RE, INVITE_CODE_RE } from './ids.js';
import { csvCell, toCsv } from './csv.js';
import { isFinalPathFor, isTmpPathFor, sniffImage, validateImageRequest, MAX_IMAGE_BYTES } from './media.js';
import { hostTeam, myTeam, publicHackathon } from './serialize.js';
import { parseModeration, parseSubmission } from './validate.js';

const H = { id: 'h', publishedAt: new Date(), disabledAt: null, eligibility: 'registered' };
const g = (over: Partial<GuestLike> = {}): GuestLike => ({ id: 'g1', approved: true, status: 'CONFIRMED', checkedInAt: null, ...over });
const opts = { loggedIn: true, isJudge: false, requireApproval: true };

describe('decideEligibility', () => {
  it('approved confirmed guest is eligible and the guest id is kept', () => {
    expect(decideEligibility(H, [g()], opts)).toEqual({ eligible: true, reason: null, guestId: 'g1' });
  });
  it('unpublished / disabled / missing hackathon: not_available (before anything else)', () => {
    expect(decideEligibility({ ...H, publishedAt: null }, [g()], opts).reason).toBe('not_available');
    expect(decideEligibility({ ...H, disabledAt: new Date() }, [g()], opts).reason).toBe('not_available');
    expect(decideEligibility(null, [g()], opts).reason).toBe('not_available');
  });
  it('logged out, judge, no RSVP', () => {
    expect(decideEligibility(H, [g()], { ...opts, loggedIn: false }).reason).toBe('login');
    expect(decideEligibility(H, [g()], { ...opts, isJudge: true }).reason).toBe('judge');
    expect(decideEligibility(H, [], opts).reason).toBe('no_rsvp');
  });
  it('declined, pending (approval required), waitlisted', () => {
    expect(decideEligibility(H, [g({ approved: false })], opts).reason).toBe('declined');
    expect(decideEligibility(H, [g({ approved: null })], opts).reason).toBe('pending_approval');
    expect(decideEligibility(H, [g({ approved: null })], { ...opts, requireApproval: false }).eligible).toBe(true);
    expect(decideEligibility(H, [g({ status: 'WAITLISTED' })], opts).reason).toBe('waitlisted');
  });
  it('checked_in mode needs a check-in', () => {
    const ci = { ...H, eligibility: 'checked_in' };
    expect(decideEligibility(ci, [g()], opts).reason).toBe('not_checked_in');
    expect(decideEligibility(ci, [g({ checkedInAt: new Date() })], opts).eligible).toBe(true);
  });
  it('several RSVPs with one email: the best row wins', () => {
    const r = decideEligibility(H, [g({ id: 'bad', approved: false }), g({ id: 'ok' })], opts);
    expect(r).toEqual({ eligible: true, reason: null, guestId: 'ok' });
  });
});

describe('normalizeProjectUrl', () => {
  const n = (v: unknown) => normalizeProjectUrl(v, 'Link');
  it('accepts https, upgrades http and bare hosts', () => {
    expect(n('https://github.com/a/b')).toBe('https://github.com/a/b');
    expect(n('http://example.com/x')).toBe('https://example.com/x');
    expect(n('github.com/a')).toBe('https://github.com/a');
    expect(n('  ')).toBeNull();
    expect(n(null)).toBeNull();
  });
  it.each([
    'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'https://user:pw@example.com',
    'https://127.0.0.1/x', 'https://[::1]/', 'https://localhost/x', 'https://foo.localhost', 'https://intranet/',
    'https://example.com:8080/', 'https://exa mple.com', 'https://example.com/\u0000', 42,
  ])('rejects %s', (v) => {
    expect(() => n(v)).toThrow();
  });
  it('rejects over 500 chars', () => {
    expect(() => n('https://example.com/' + 'a'.repeat(490))).toThrow(/500/);
  });
});

describe('invite codes and slugs', () => {
  it('codes are 10-char base32 and normalize case-insensitively', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = generateInviteCode();
      expect(c).toMatch(INVITE_CODE_RE);
      seen.add(c);
    }
    expect(seen.size).toBe(200);
    expect(normalizeInviteCode(' ABCDEFGH23 ')).toBe('abcdefgh23');
    expect(normalizeInviteCode('abc')).toBeNull();
    expect(normalizeInviteCode("abcdefgh2'")).toBeNull();
    expect(normalizeInviteCode({})).toBeNull();
  });
  it('slugify always satisfies the DB CHECK', () => {
    for (const name of ['My Cool App!', '  --  ', 'Café Ünïcode', '🍕🍕', 'a'.repeat(200), 'x--y', '日本語']) {
      expect(slugify(name)).toMatch(SLUG_RE);
      expect(slugify(name).length).toBeLessThanOrEqual(60);
    }
    expect(slugify('My Cool App!')).toBe('my-cool-app');
    expect(slugify('🍕')).toBe('project');
  });
  it('pickSlug resolves collisions', () => {
    expect(pickSlug('app', new Set())).toBe('app');
    expect(pickSlug('app', new Set(['app']))).toBe('app-2');
    expect(pickSlug('app', new Set(['app', 'app-2', 'app-3']))).toBe('app-4');
    const all = new Set(['app', ...Array.from({ length: 98 }, (_, i) => `app-${i + 2}`)]);
    expect(pickSlug('app', all)).toMatch(/^app-[0-9a-f]{8}$/);
  });
});

describe('CSV escaping', () => {
  it.each([
    ['=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
    ['+1+2', "'+1+2"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tcmd', "'\tcmd"],
    ['a,b', '"a,b"'],
    ['line\nbreak', '"line\nbreak"'],
    ['say "hi"', '"say ""hi"""'],
    ['plain', 'plain'],
  ])('%j -> %j', (input, out) => {
    expect(csvCell(input)).toBe(out);
  });
  it('null, arrays, dates', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(['a', '=b'])).toBe('a; =b');
    expect(csvCell(new Date('2027-01-01T00:00:00Z'))).toBe('2027-01-01T00:00:00.000Z');
  });
  it('toCsv adds a BOM and CRLF rows', () => {
    expect(toCsv(['A'], [['=x']])).toBe("﻿A\r\n'=x\r\n");
  });
});

describe('media paths + sniffing', () => {
  const HID = '22222222-2222-4222-8222-222222222222';
  const SID = '33333333-3333-4333-8333-333333333333';
  const OTHER = '44444444-4444-4444-8444-444444444444';
  const U = '55555555-5555-4555-8555-555555555555';
  it('tmp + final paths are scoped to the hackathon and submission', () => {
    expect(isTmpPathFor(`${HID}/${SID}/tmp/${U}.png`, HID, SID)).toBe(true);
    expect(isTmpPathFor(`${OTHER}/${SID}/tmp/${U}.png`, HID, SID)).toBe(false);
    expect(isTmpPathFor(`${HID}/${OTHER}/tmp/${U}.png`, HID, SID)).toBe(false);
    expect(isTmpPathFor(`${HID}/${SID}/${U}.png`, HID, SID)).toBe(false);
    expect(isTmpPathFor(`${HID}/${SID}/tmp/../${U}.png`, HID, SID)).toBe(false);
    expect(isTmpPathFor(`${HID}/${SID}/tmp/${U}.svg`, HID, SID)).toBe(false);
    expect(isFinalPathFor(`${HID}/${SID}/${U}.webp`, HID, SID)).toBe(true);
    expect(isFinalPathFor(`${HID}/${SID}/tmp/${U}.webp`, HID, SID)).toBe(false);
    expect(isFinalPathFor(`${HID}/${OTHER}/${U}.webp`, HID, SID)).toBe(false);
  });
  it('upload requests: images only, 10 MB', () => {
    expect(validateImageRequest('image/png', 1000)).toBe('png');
    expect(() => validateImageRequest('image/svg+xml', 1000)).toThrow();
    expect(() => validateImageRequest('application/pdf', 1000)).toThrow();
    expect(() => validateImageRequest('image/png', MAX_IMAGE_BYTES + 1)).toThrow(/10 MB/);
    expect(() => validateImageRequest('image/png', 0)).toThrow();
    expect(() => validateImageRequest('image/png', '5')).toThrow();
  });
  it('sniffs magic bytes', () => {
    const pad = (b: number[]) => Buffer.from([...b, ...Array(16).fill(0)]);
    expect(sniffImage(pad([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(sniffImage(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImage(Buffer.from('GIF89a' + '\0'.repeat(10), 'latin1'))).toBe('image/gif');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBP' + '\0'.repeat(4), 'latin1'))).toBe('image/webp');
    expect(sniffImage(Buffer.from('\0\0\0\x1cftypavif' + '\0'.repeat(4), 'latin1'))).toBe('image/avif');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">', 'latin1'))).toBeNull();
  });
});

describe('validate: submissions + moderation', () => {
  const url = (v: unknown) => normalizeProjectUrl(v, 'x');
  it('name required on create; caps per DB CHECKs; NUL rejected', () => {
    expect(() => parseSubmission({}, true, url)).toThrow(/required/);
    expect(parseSubmission({ tagline: 'x' }, false, url).data).toEqual({ tagline: 'x' });
    expect(() => parseSubmission({ name: 'a'.repeat(81) }, true, url)).toThrow(/80/);
    expect(() => parseSubmission({ name: 'ok', tagline: 'a'.repeat(141) }, true, url)).toThrow(/140/);
    expect(() => parseSubmission({ name: 'ok', description: 'a'.repeat(10001) }, true, url)).toThrow(/10000/);
    expect(() => parseSubmission({ name: 'bad\u0000' }, true, url)).toThrow(/invalid character/);
    expect(() => parseSubmission({ name: 'ok', repoUrl: 'javascript:x' }, true, url)).toThrow();
    expect(() => parseSubmission({ name: 'ok', trackIds: ['nope'] }, true, url)).toThrow(/tracks/);
    expect(parseSubmission({ name: 'ok', trackIds: [] }, true, url).trackIds).toEqual([]);
  });
  it('moderation', () => {
    expect(() => parseModeration({ action: 'disqualify' })).toThrow(/Reason/);
    expect(parseModeration({ action: 'disqualify', reason: ' plagiarism ' })).toEqual({ action: 'disqualify', reason: 'plagiarism' });
    expect(parseModeration({ action: 'restore' })).toEqual({ action: 'restore' });
    expect(() => parseModeration({ action: 'delete' })).toThrow();
    expect(() => parseModeration({})).toThrow();
    expect(() => parseModeration({ tableNumber: 'a'.repeat(21) })).toThrow();
  });
});

describe('team serializers', () => {
  const team = {
    id: 't1', hackathonId: 'h', name: 'Team', inviteCode: 'abcdefgh23', createdByUserId: 'u-a', createdAt: new Date(),
    members: [
      { id: 'm1', userId: 'u-a', guestId: 'g-a', role: 'captain', joinedAt: new Date(), user: { name: 'Alice', email: 'alice@secret.example', profilePictureUrl: 'https://img/a.png' }, guest: null },
      { id: 'm2', userId: 'u-b', guestId: 'g-b', role: 'member', joinedAt: new Date(), user: { name: null, email: 'bob@secret.example', profilePictureUrl: null }, guest: { name: 'Bob G', email: 'bob@secret.example' } },
    ],
    submissions: [{
      id: 's1', name: 'P', slug: 'p', status: 'disqualified', disqualifiedReason: 'copied', coverPath: 'c.png', screenshotPaths: ['s.png'],
      tracks: [{ trackId: 'tr' }], createdAt: new Date(), updatedAt: new Date(), hackathonId: 'h', teamId: 't1',
    }],
  };
  it('member view: names/avatars/roles only, no emails or user/guest ids', () => {
    const t = myTeam(team, 'u-b', { 'c.png': 'https://signed/c' });
    const body = JSON.stringify(t);
    for (const s of ['secret.example', 'u-a', 'u-b', 'g-a', 'g-b', 'hackathonId', 'createdByUserId']) expect(body).not.toContain(s);
    expect(t.members.map((m) => [m.name, m.role, m.isMe])).toEqual([['Alice', 'captain', false], ['Bob G', 'member', true]]);
    expect(t.submission?.cover).toEqual({ path: 'c.png', url: 'https://signed/c' });
    expect(t.submission?.screenshots).toEqual([{ path: 's.png', url: null }]);
    expect(t.submission?.disqualifiedReason).toBe('copied');
  });
  it('host view adds emails + guest ids but still no user ids', () => {
    const t = hostTeam(team, {});
    expect(t.members[0].email).toBe('alice@secret.example');
    expect(t.members[1].guestId).toBe('g-b');
    expect(JSON.stringify(t)).not.toContain('u-a');
  });
  it('the public hackathon shape never carries teams or submissions', () => {
    const pub = publicHackathon({ ...H, teams: [team], submissions: team.submissions, members: team.members, tracks: [], prizes: [], criteria: [] });
    const body = JSON.stringify(pub);
    for (const s of ['Team', 'abcdefgh23', 'secret.example', 's1', 'copied']) expect(body).not.toContain(s);
  });
});
