import { describe, it, expect } from 'vitest';
import { assignMembers, collectIdentifiers, eligible, hashEmail, type TagGuest } from './nametagMerge.js';
import type { NametagMember } from '../services/pizzadaoNametags.js';

const g = (id: string, o: Partial<TagGuest> = {}): TagGuest => ({
  id,
  email: `${id}@example.com`,
  submittedVia: 'link',
  status: 'CONFIRMED',
  approved: null,
  emailVerifiedAt: new Date('2026-01-01'),
  ...o,
});
const member = (memberId: string): NametagMember => ({ memberId, name: `Member ${memberId}`, pfpUrl: 'https://img.example/x.png' });

describe('eligible / collectIdentifiers', () => {
  it('sends only self-RSVPs that are confirmed, not declined, with a proven email', () => {
    const guests = [
      g('ok'),
      g('host-added', { submittedVia: 'host' }),
      g('imported', { submittedVia: 'import-csv' }),
      g('checkin', { submittedVia: 'host-checkin' }),
      g('invited', { submittedVia: 'invite' }),
      g('waitlisted', { status: 'WAITLISTED' }),
      g('pending-invite', { status: 'INVITED' }),
      g('declined', { approved: false }),
      g('unproven', { emailVerifiedAt: null }),
      g('no-email', { email: null }),
    ];
    expect(guests.filter(eligible).map((x) => x.id)).toEqual(['ok']);
    const ids = collectIdentifiers(guests);
    expect(ids.emailHashes).toEqual([hashEmail('ok@example.com')]);
    expect(ids.wallets).toEqual([]);
    expect(JSON.stringify(ids)).not.toContain('@');
  });
  it('hashes lower-cased trimmed emails and dedupes', () => {
    const ids = collectIdentifiers([g('a', { email: '  Guest@Example.com ' }), g('b', { email: 'guest@example.com' })]);
    expect(ids.emailHashes).toEqual([hashEmail('guest@example.com')]);
  });
});

describe('assignMembers', () => {
  it('maps eligible guests to the member for their email hash only', () => {
    const out = assignMembers(
      [g('a'), g('b'), g('declined', { approved: false })],
      [
        { emailHash: hashEmail('a@example.com'), member: member('1') },
        { emailHash: hashEmail('declined@example.com'), member: member('3') },
        { wallet: '0x' + '1'.repeat(40), member: member('9') },
      ],
    );
    expect(Object.keys(out)).toEqual(['a']);
    expect(out.a.memberId).toBe('1');
  });
});
