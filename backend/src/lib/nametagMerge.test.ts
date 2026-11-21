import { describe, it, expect } from 'vitest';
import { assignMembers, collectIdentifiers, eligible, hashEmail, type TagGuest } from './nametagMerge.js';
import type { NametagMember } from '../services/pizzadaoNametags.js';

const g = (id: string, o: Partial<TagGuest> = {}): TagGuest => ({
  id,
  email: `${id}@example.com`,
  submittedVia: 'link',
  status: 'CONFIRMED',
  approved: null,
  ethereumAddress: null,
  ...o,
});
const member = (memberId: string): NametagMember => ({ memberId, name: `Member ${memberId}`, pfpUrl: 'https://img.example/x.png' });

const W = '0x' + 'AB'.repeat(20);

describe('eligible / collectIdentifiers', () => {
  it('sends only self-RSVPs that are confirmed and not declined', () => {
    const guests = [
      g('ok', { ethereumAddress: W }),
      g('host-added', { submittedVia: 'host' }),
      g('imported', { submittedVia: 'import-csv' }),
      g('checkin', { submittedVia: 'host-checkin' }),
      g('invited', { submittedVia: 'invite' }),
      g('waitlisted', { status: 'WAITLISTED' }),
      g('pending-invite', { status: 'INVITED' }),
      g('declined', { approved: false }),
    ];
    expect(guests.filter(eligible).map((x) => x.id)).toEqual(['ok']);
    const ids = collectIdentifiers(guests);
    expect(ids.emailHashes).toEqual([hashEmail('ok@example.com')]);
    expect(ids.wallets).toEqual([W.toLowerCase()]);
    expect(JSON.stringify(ids)).not.toContain('@');
  });
  it('hashes lower-cased trimmed emails, lower-cases wallets, drops junk, dedupes', () => {
    const ids = collectIdentifiers([
      g('a', { email: '  Guest@Example.com ', ethereumAddress: W }),
      g('b', { email: 'guest@example.com', ethereumAddress: W.toLowerCase() }),
      g('c', { email: 'not-an-email', ethereumAddress: '0x12' }),
      g('d', { email: null }),
    ]);
    expect(ids.emailHashes).toEqual([hashEmail('guest@example.com')]);
    expect(ids.wallets).toEqual([W.toLowerCase()]);
  });
});

describe('assignMembers', () => {
  it('maps eligible guests by email hash, falls back to wallet, ignores ineligible guests', () => {
    const out = assignMembers(
      [g('a'), g('b', { email: null, ethereumAddress: W }), g('c'), g('declined', { approved: false })],
      [
        { emailHash: hashEmail('a@example.com'), member: member('1') },
        { wallet: W.toLowerCase(), member: member('2') },
        { emailHash: hashEmail('declined@example.com'), member: member('3') },
      ],
    );
    expect(Object.keys(out).sort()).toEqual(['a', 'b']);
    expect(out.a.memberId).toBe('1');
    expect(out.b.memberId).toBe('2');
  });
  it('an email match wins over a wallet match', () => {
    const out = assignMembers([g('a', { ethereumAddress: W })], [{ emailHash: hashEmail('a@example.com'), member: member('1') }, { wallet: W.toLowerCase(), member: member('2') }]);
    expect(out.a.memberId).toBe('1');
  });
});
