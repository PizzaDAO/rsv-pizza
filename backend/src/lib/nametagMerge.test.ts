import { describe, it, expect } from 'vitest';
import { assignMembers, collectIdentifiers, hashEmail, type TagGuest } from './nametagMerge.js';
import type { NametagMember } from '../services/pizzadaoNametags.js';

const W = '0x' + 'AB'.repeat(20);
const g = (id: string, o: Partial<TagGuest> = {}): TagGuest => ({
  id,
  email: null,
  ethereumAddress: null,
  submittedAt: new Date('2026-01-01T10:00:00Z'),
  approved: null,
  ...o,
});
const member = (memberId: string): NametagMember => ({ memberId, name: `Member ${memberId}`, pfpUrl: 'https://img.example/x.png' });

describe('collectIdentifiers', () => {
  it('hashes lower-cased trimmed emails, lower-cases valid wallets, skips declined and junk', () => {
    const ids = collectIdentifiers([
      g('1', { email: '  Guest@Example.com ', ethereumAddress: W }),
      g('2', { email: 'guest@example.com' }),
      g('3', { email: 'declined@example.com', approved: false }),
      g('4', { email: 'not-an-email', ethereumAddress: '0x12' }),
    ]);
    expect(ids.emailHashes).toEqual([hashEmail('guest@example.com')]);
    expect(ids.wallets).toEqual([W.toLowerCase()]);
    expect(JSON.stringify(ids)).not.toContain('@');
  });
});

describe('assignMembers', () => {
  it('matches by email hash, falls back to wallet, leaves others out', () => {
    const out = assignMembers(
      [g('a', { email: 'a@example.com' }), g('b', { ethereumAddress: W }), g('c', { email: 'c@example.com' })],
      [
        { emailHash: hashEmail('a@example.com'), member: member('1') },
        { wallet: W.toLowerCase(), member: member('2') },
      ],
    );
    expect(Object.keys(out).sort()).toEqual(['a', 'b']);
    expect(out.a.memberId).toBe('1');
    expect(out.b.memberId).toBe('2');
  });
  it('gives a member who RSVPd twice one tag, on the earliest RSVP', () => {
    const out = assignMembers(
      [
        g('late', { email: 'x@example.com', submittedAt: new Date('2026-02-01') }),
        g('early', { email: 'y@example.com', submittedAt: new Date('2026-01-01') }),
      ],
      [
        { emailHash: hashEmail('x@example.com'), member: member('7') },
        { emailHash: hashEmail('y@example.com'), member: member('7') },
      ],
    );
    expect(Object.keys(out)).toEqual(['early']);
  });
  it('never matches a declined guest', () => {
    const out = assignMembers([g('d', { email: 'd@example.com', approved: false })], [{ emailHash: hashEmail('d@example.com'), member: member('9') }]);
    expect(out).toEqual({});
  });
});
