import { describe, it, expect } from 'vitest';
import {
  shannon,
  fieldSignature,
  filterDirectRsvps,
  checkCapFillNoWaitlist,
  checkLowDomainEntropy,
  checkSigCollapse,
  checkWalletTooLow,
  checkWalletTooHighReuse,
  checkWalletReuse,
  checkHostSelfRsvpMismatch,
  checkPizzeriaFieldsBlank,
  checkWalletSourceAllNull,
  checkOneWordName,
  checkFirstnameDigitsEmail,
  checkDayGapPattern,
  checkLowHourEntropy,
  checkRapidIntersubmission,
  checkCrossEventWallet,
  checkLowFunnelCoverage,
  checkHighPerVisitorRsvpSaturation,
  checkCoHostTwitterHandlesMissing,
  scoreEvent,
  buildSybilWalletSet,
  tierFromScore,
  WEIGHTS,
  type FakeDetectionGuest,
  type FakeDetectionParty,
  type FakeDetectionLinkClick,
  type FakeDetectionFunnelEvent,
} from './fakeDetection.js';

// ============================================
// Fixture helpers
// ============================================

function makeGuest(overrides: Partial<FakeDetectionGuest> = {}): FakeDetectionGuest {
  return {
    id: 'g-' + Math.random().toString(36).slice(2, 9),
    name: 'Mario Rossi',
    email: 'mario@example.com',
    ethereumAddress: null,
    submittedAt: new Date('2026-04-01T12:00:00Z'),
    submittedVia: 'link',
    waitlistPosition: null,
    walletSource: null,
    likedToppings: ['mushroom'],
    dislikedToppings: [],
    likedBeverages: [],
    dislikedBeverages: [],
    dietaryRestrictions: [],
    roles: [],
    pizzeriaRankings: ['da Michele', 'Sorbillo'],
    suggestedPizzerias: [{ name: 'da Michele' }],
    ...overrides,
  };
}

function makeFunnelEvent(
  overrides: Partial<FakeDetectionFunnelEvent> = {},
): FakeDetectionFunnelEvent {
  return {
    visitorHash: 'visitor-default',
    step: 'rsvp_opened',
    createdAt: new Date('2026-04-01T12:00:00Z'),
    ...overrides,
  };
}

function makeParty(overrides: Partial<FakeDetectionParty> = {}): FakeDetectionParty {
  return {
    id: 'party-1',
    name: 'Global Pizza Party Test',
    customUrl: 'test',
    country: 'IT',
    region: 'western-europe',
    timezone: 'Europe/Rome',
    maxGuests: 100,
    createdAt: new Date('2026-03-01T10:00:00Z'),
    underbossStatus: 'pending',
    user: { name: 'Host Person', email: 'host@example.com' },
    coHosts: [],
    ...overrides,
  };
}

// ============================================
// Helpers
// ============================================

describe('shannon', () => {
  it('returns 0 for empty input', () => {
    expect(shannon([])).toBe(0);
  });
  it('returns 0 for single-value uniform input', () => {
    expect(shannon(['a', 'a', 'a'])).toBe(0);
  });
  it('returns 1 for two equally likely values', () => {
    expect(shannon(['a', 'b'])).toBeCloseTo(1);
  });
  it('uses log base 2', () => {
    // 4 distinct equally likely values → entropy = log2(4) = 2
    expect(shannon(['a', 'b', 'c', 'd'])).toBeCloseTo(2);
  });
});

describe('fieldSignature', () => {
  it('produces equal signatures regardless of array order', () => {
    const a = makeGuest({ likedToppings: ['mushroom', 'pepperoni'], roles: ['x', 'y'] });
    const b = makeGuest({ likedToppings: ['pepperoni', 'mushroom'], roles: ['y', 'x'] });
    expect(fieldSignature(a)).toBe(fieldSignature(b));
  });
  it('produces different signatures for different content', () => {
    const a = makeGuest({ likedToppings: ['mushroom'] });
    const b = makeGuest({ likedToppings: ['pepperoni'] });
    expect(fieldSignature(a)).not.toBe(fieldSignature(b));
  });
});

describe('filterDirectRsvps', () => {
  it('keeps link/rsvp/api and drops invite/host/host-checkin', () => {
    const guests = [
      makeGuest({ submittedVia: 'link' }),
      makeGuest({ submittedVia: 'rsvp' }),
      makeGuest({ submittedVia: 'api' }),
      makeGuest({ submittedVia: 'invite' }),
      makeGuest({ submittedVia: 'host' }),
      makeGuest({ submittedVia: 'host-checkin' }),
    ];
    expect(filterDirectRsvps(guests).length).toBe(3);
  });
});

// ============================================
// Per-heuristic edge cases
// ============================================

describe('checkCapFillNoWaitlist', () => {
  it('does not fire below min n', () => {
    const guests = Array.from({ length: 19 }, () => makeGuest());
    expect(checkCapFillNoWaitlist(guests, 20).fired).toBe(false);
  });
  it('fires when ≥90% full and zero waitlist', () => {
    const guests = Array.from({ length: 90 }, () => makeGuest());
    expect(checkCapFillNoWaitlist(guests, 100).fired).toBe(true);
  });
  it('does not fire when there is a waitlist', () => {
    const guests = Array.from({ length: 90 }, (_, i) =>
      makeGuest({ waitlistPosition: i >= 88 ? i - 87 : null }),
    );
    expect(checkCapFillNoWaitlist(guests, 100).fired).toBe(false);
  });
  it('does not fire without maxGuests', () => {
    const guests = Array.from({ length: 50 }, () => makeGuest());
    expect(checkCapFillNoWaitlist(guests, null).fired).toBe(false);
  });
});

describe('checkLowDomainEntropy', () => {
  it('does not fire below min n', () => {
    const guests = Array.from({ length: 10 }, () => makeGuest({ email: 'a@b.com' }));
    expect(checkLowDomainEntropy(guests).fired).toBe(false);
  });
  it('fires when all emails share one domain', () => {
    const guests = Array.from({ length: 30 }, (_, i) => makeGuest({ email: `user${i}@spam.com` }));
    expect(checkLowDomainEntropy(guests).fired).toBe(true);
  });
  it('does not fire with diverse domains', () => {
    const guests = Array.from({ length: 30 }, (_, i) =>
      makeGuest({ email: `user@d${i}.com` }),
    );
    expect(checkLowDomainEntropy(guests).fired).toBe(false);
  });
});

describe('checkSigCollapse', () => {
  it('fires when signatures collapse to one', () => {
    const guests = Array.from({ length: 30 }, () => makeGuest({ likedToppings: ['x'] }));
    expect(checkSigCollapse(guests).fired).toBe(true);
  });
  it('does not fire when signatures are diverse', () => {
    const guests = Array.from({ length: 30 }, (_, i) =>
      makeGuest({ likedToppings: [`topping${i}`] }),
    );
    expect(checkSigCollapse(guests).fired).toBe(false);
  });
});

describe('checkWalletTooLow', () => {
  it('fires when <5% have wallets', () => {
    const guests = Array.from({ length: 50 }, () => makeGuest({ ethereumAddress: null }));
    expect(checkWalletTooLow(guests).fired).toBe(true);
  });
  it('does not fire when wallet ratio is healthy', () => {
    const guests = Array.from({ length: 50 }, (_, i) =>
      makeGuest({ ethereumAddress: `0x${i.toString(16).padStart(40, '0')}` }),
    );
    expect(checkWalletTooLow(guests).fired).toBe(false);
  });
});

describe('checkWalletTooHighReuse', () => {
  it('fires when ≥95% have wallets and reuse >30%', () => {
    const guests = Array.from({ length: 50 }, (_, i) =>
      makeGuest({ ethereumAddress: i < 25 ? '0xshared' : `0x${i}` }),
    );
    expect(checkWalletTooHighReuse(guests).fired).toBe(true);
  });
  it('does not fire when wallet count below 95%', () => {
    const guests = Array.from({ length: 50 }, (_, i) =>
      makeGuest({ ethereumAddress: i < 25 ? `0x${i}` : null }),
    );
    expect(checkWalletTooHighReuse(guests).fired).toBe(false);
  });
});

describe('checkWalletReuse', () => {
  it('fires when 10%+ of wallets are duplicates', () => {
    const guests = [
      ...Array.from({ length: 9 }, () => makeGuest({ ethereumAddress: '0xshared' })),
      makeGuest({ ethereumAddress: '0xshared' }),
      ...Array.from({ length: 5 }, (_, i) => makeGuest({ ethereumAddress: `0x${i}` })),
    ];
    expect(checkWalletReuse(guests).fired).toBe(true);
  });
  it('does not fire with all-unique wallets', () => {
    const guests = Array.from({ length: 15 }, (_, i) =>
      makeGuest({ ethereumAddress: `0x${i.toString(16).padStart(40, '0')}` }),
    );
    expect(checkWalletReuse(guests).fired).toBe(false);
  });
});

describe('checkHostSelfRsvpMismatch', () => {
  it('fires for a sub-60s RSVP with non-matching name', () => {
    const party = makeParty({
      createdAt: new Date('2026-03-01T10:00:00Z'),
      user: { name: 'Alice Host', email: 'alice@host.com' },
    });
    const guests = [
      makeGuest({
        name: 'Some Other Name',
        email: 'other@x.com',
        submittedAt: new Date('2026-03-01T10:00:30Z'),
      }),
    ];
    expect(checkHostSelfRsvpMismatch(guests, party).fired).toBe(true);
  });
  it('does not fire when name matches host', () => {
    const party = makeParty({
      createdAt: new Date('2026-03-01T10:00:00Z'),
      user: { name: 'Alice Host', email: 'alice@host.com' },
    });
    const guests = [
      makeGuest({
        name: 'Alice Host',
        email: 'something@else.com',
        submittedAt: new Date('2026-03-01T10:00:30Z'),
      }),
    ];
    expect(checkHostSelfRsvpMismatch(guests, party).fired).toBe(false);
  });
  it('does not fire when delta exceeds 60s', () => {
    const party = makeParty({
      createdAt: new Date('2026-03-01T10:00:00Z'),
      user: { name: 'Alice Host', email: 'alice@host.com' },
    });
    const guests = [
      makeGuest({
        name: 'Mystery Name',
        email: 'rando@x.com',
        submittedAt: new Date('2026-03-01T10:02:00Z'),
      }),
    ];
    expect(checkHostSelfRsvpMismatch(guests, party).fired).toBe(false);
  });
});

describe('checkPizzeriaFieldsBlank', () => {
  it('fires when nearly all pizzeria fields are empty', () => {
    const guests = Array.from({ length: 30 }, () =>
      makeGuest({ pizzeriaRankings: [], suggestedPizzerias: [] }),
    );
    expect(checkPizzeriaFieldsBlank(guests).fired).toBe(true);
  });
  it('does not fire when guests fill the fields', () => {
    const guests = Array.from({ length: 30 }, () =>
      makeGuest({ pizzeriaRankings: ['x', 'y'], suggestedPizzerias: [{ name: 'z' }] }),
    );
    expect(checkPizzeriaFieldsBlank(guests).fired).toBe(false);
  });
});

describe('checkWalletSourceAllNull', () => {
  it('fires when every walletSource is null', () => {
    const guests = Array.from({ length: 30 }, () => makeGuest({ walletSource: null }));
    expect(checkWalletSourceAllNull(guests).fired).toBe(true);
  });
  it('does not fire when any walletSource is set', () => {
    const guests = Array.from({ length: 30 }, (_, i) =>
      makeGuest({ walletSource: i === 0 ? 'privy' : null }),
    );
    expect(checkWalletSourceAllNull(guests).fired).toBe(false);
  });
});

describe('checkOneWordName', () => {
  it('fires when >20% of names are single-word', () => {
    const guests = Array.from({ length: 30 }, (_, i) =>
      makeGuest({ name: i < 10 ? 'Mario' : 'Mario Rossi' }),
    );
    expect(checkOneWordName(guests).fired).toBe(true);
  });
  it('does not fire with mostly multi-word names', () => {
    const guests = Array.from({ length: 30 }, () => makeGuest({ name: 'Mario Rossi' }));
    expect(checkOneWordName(guests).fired).toBe(false);
  });
});

describe('checkFirstnameDigitsEmail', () => {
  it('fires when >95% of emails match firstname+digits and domains low entropy', () => {
    const guests = Array.from({ length: 30 }, (_, i) =>
      makeGuest({ email: `mario${i}@spam.com` }),
    );
    expect(checkFirstnameDigitsEmail(guests).fired).toBe(true);
  });
  it('does not fire when emails are realistic', () => {
    const guests = Array.from({ length: 30 }, (_, i) =>
      makeGuest({ email: `mario.rossi${i}@gmail.com` }),
    );
    expect(checkFirstnameDigitsEmail(guests).fired).toBe(false);
  });
});

describe('checkDayGapPattern', () => {
  it('skips cleanly when link_clicks is empty', () => {
    const guests = Array.from({ length: 30 }, () => makeGuest());
    const party = makeParty();
    expect(checkDayGapPattern(guests, party, []).fired).toBe(false);
  });
  it('fires when ≥2 zero days are bracketed by 5+ RSVP days and no click spike', () => {
    const party = makeParty({ timezone: null });
    // Day 1: 6 RSVPs, Days 2-3: 0 RSVPs, Day 4: 6 RSVPs
    const guests: FakeDetectionGuest[] = [
      ...Array.from({ length: 6 }, () => makeGuest({ submittedAt: new Date('2026-04-01T12:00:00Z') })),
      ...Array.from({ length: 14 }, (_, i) => makeGuest({ submittedAt: new Date('2026-04-01T13:00:00Z') })),
      ...Array.from({ length: 6 }, () => makeGuest({ submittedAt: new Date('2026-04-04T12:00:00Z') })),
    ];
    // Some click data exists but none on the zero days
    const linkClicks: FakeDetectionLinkClick[] = [
      { clickedAt: new Date('2026-04-01T12:00:00Z') },
      { clickedAt: new Date('2026-04-04T12:00:00Z') },
    ];
    expect(checkDayGapPattern(guests, party, linkClicks).fired).toBe(true);
  });
});

describe('checkLowHourEntropy', () => {
  it('fires when all submissions cluster into one hour', () => {
    const guests = Array.from({ length: 30 }, () =>
      makeGuest({ submittedAt: new Date('2026-04-01T12:30:00Z') }),
    );
    expect(checkLowHourEntropy(guests, makeParty({ timezone: null })).fired).toBe(true);
  });
  it('does not fire when hours are spread', () => {
    const guests = Array.from({ length: 24 }, (_, i) =>
      makeGuest({
        submittedAt: new Date(`2026-04-01T${i.toString().padStart(2, '0')}:00:00Z`),
      }),
    );
    expect(checkLowHourEntropy(guests, makeParty({ timezone: null })).fired).toBe(false);
  });
});

describe('checkRapidIntersubmission', () => {
  it('fires when median delta ≤ 60s', () => {
    const base = new Date('2026-04-01T12:00:00Z').getTime();
    const guests = Array.from({ length: 30 }, (_, i) =>
      makeGuest({ submittedAt: new Date(base + i * 30000) }), // 30s apart
    );
    expect(checkRapidIntersubmission(guests).fired).toBe(true);
  });
  it('does not fire when submissions are well-spaced', () => {
    const base = new Date('2026-04-01T12:00:00Z').getTime();
    const guests = Array.from({ length: 30 }, (_, i) =>
      makeGuest({ submittedAt: new Date(base + i * 3600000) }), // 1 hour apart
    );
    expect(checkRapidIntersubmission(guests).fired).toBe(false);
  });
});

describe('checkCrossEventWallet', () => {
  it('fires when any guest wallet is in the sybil set', () => {
    const sybils = new Set(['0xbadwallet']);
    const guests = [makeGuest({ ethereumAddress: '0xbadwallet' })];
    expect(checkCrossEventWallet(guests, sybils).fired).toBe(true);
  });
  it('does not fire when no guest wallet is sybil', () => {
    const sybils = new Set(['0xbadwallet']);
    const guests = [makeGuest({ ethereumAddress: '0xgoodwallet' })];
    expect(checkCrossEventWallet(guests, sybils).fired).toBe(false);
  });
});

describe('checkLowFunnelCoverage', () => {
  it('does not fire below min n=30', () => {
    const guests = Array.from({ length: 20 }, () => makeGuest());
    const funnel = Array.from({ length: 20 }, (_, i) =>
      makeFunnelEvent({ visitorHash: `v${i}`, step: 'rsvp_opened' }),
    );
    expect(checkLowFunnelCoverage(guests, funnel).fired).toBe(false);
  });
  it('fires for Ilemela-like sparse funnel (7 unique visitors / 100 RSVPs)', () => {
    const guests = Array.from({ length: 100 }, () => makeGuest());
    const funnel = Array.from({ length: 7 }, (_, i) =>
      makeFunnelEvent({ visitorHash: `v${i}`, step: 'rsvp_opened' }),
    );
    const result = checkLowFunnelCoverage(guests, funnel);
    expect(result.fired).toBe(true);
    expect(result.evidence?.uniqueVisitors).toBe(7);
    expect(result.evidence?.linkRsvpCount).toBe(100);
  });
  it('does not fire for Lilongwe-like healthy funnel (8 unique visitors / 44 RSVPs = 0.18)', () => {
    const guests = Array.from({ length: 44 }, () => makeGuest());
    const funnel = Array.from({ length: 8 }, (_, i) =>
      makeFunnelEvent({ visitorHash: `v${i}`, step: 'rsvp_opened' }),
    );
    expect(checkLowFunnelCoverage(guests, funnel).fired).toBe(false);
  });
  it('ignores non-opened steps in coverage count', () => {
    const guests = Array.from({ length: 40 }, () => makeGuest());
    // 20 unique visitors but all on a non-opened step → coverage = 0
    const funnel = Array.from({ length: 20 }, (_, i) =>
      makeFunnelEvent({ visitorHash: `v${i}`, step: 'rsvp_submitted' }),
    );
    expect(checkLowFunnelCoverage(guests, funnel).fired).toBe(true);
  });
});

describe('checkHighPerVisitorRsvpSaturation', () => {
  it('does not fire when there is no funnel data', () => {
    const guests = Array.from({ length: 10 }, () => makeGuest());
    expect(checkHighPerVisitorRsvpSaturation(guests, []).fired).toBe(false);
  });
  it('fires when one visitor temporally matches 6 distinct guests within ±10 min', () => {
    const base = new Date('2026-04-01T12:00:00Z').getTime();
    const guests = Array.from({ length: 6 }, (_, i) =>
      makeGuest({
        id: `g${i}`,
        submittedAt: new Date(base + i * 60_000), // 6 guests spaced 1 min apart
      }),
    );
    const funnel = [
      makeFunnelEvent({
        visitorHash: 'padder',
        step: 'rsvp_opened',
        createdAt: new Date(base + 2 * 60_000), // mid-window — all 6 within ±10 min
      }),
    ];
    const result = checkHighPerVisitorRsvpSaturation(guests, funnel);
    expect(result.fired).toBe(true);
    expect(result.evidence?.max).toBe(6);
    expect(result.evidence?.visitorHash).toBe('padder'.slice(0, 8));
  });
  it('does not fire when each visitor only matches 1-2 guests', () => {
    const base = new Date('2026-04-01T12:00:00Z').getTime();
    // 6 guests an hour apart → each is in its own ±10 min window
    const guests = Array.from({ length: 6 }, (_, i) =>
      makeGuest({ id: `g${i}`, submittedAt: new Date(base + i * 3600_000) }),
    );
    // Each visitor lines up with one guest
    const funnel = Array.from({ length: 6 }, (_, i) =>
      makeFunnelEvent({
        visitorHash: `v${i}`,
        step: 'rsvp_opened',
        createdAt: new Date(base + i * 3600_000),
      }),
    );
    expect(checkHighPerVisitorRsvpSaturation(guests, funnel).fired).toBe(false);
  });
  it('does not match a funnel event >10 min away from any guest', () => {
    const base = new Date('2026-04-01T12:00:00Z').getTime();
    const guests = Array.from({ length: 6 }, (_, i) =>
      makeGuest({ id: `g${i}`, submittedAt: new Date(base + i * 60_000) }),
    );
    const funnel = [
      makeFunnelEvent({
        visitorHash: 'faraway',
        step: 'rsvp_opened',
        createdAt: new Date(base + 60 * 60_000), // 60 min later — outside window
      }),
    ];
    expect(checkHighPerVisitorRsvpSaturation(guests, funnel).fired).toBe(false);
  });
});

describe('checkCoHostTwitterHandlesMissing', () => {
  it('does not fire when co_hosts is empty', () => {
    const party = makeParty({ coHosts: [] });
    expect(checkCoHostTwitterHandlesMissing(party).fired).toBe(false);
  });

  it('does not fire with only 1 filtered co-host (below min n=2)', () => {
    const party = makeParty({
      coHosts: [{ name: 'Solo Host', twitter: null }],
    });
    expect(checkCoHostTwitterHandlesMissing(party).fired).toBe(false);
  });

  it('does not fire when all 4 co-hosts have twitter handles', () => {
    const party = makeParty({
      coHosts: [
        { name: 'A', twitter: 'a_handle' },
        { name: 'B', twitter: 'b_handle' },
        { name: 'C', twitter: 'c_handle' },
        { name: 'D', twitter: 'd_handle' },
      ],
    });
    expect(checkCoHostTwitterHandlesMissing(party).fired).toBe(false);
  });

  it('fires when 2/4 (50%) co-hosts are missing twitter', () => {
    const party = makeParty({
      coHosts: [
        { name: 'A', twitter: 'a_handle' },
        { name: 'B', twitter: 'b_handle' },
        { name: 'C', twitter: null },
        { name: 'D', twitter: '' },
      ],
    });
    const result = checkCoHostTwitterHandlesMissing(party);
    expect(result.fired).toBe(true);
    expect(result.evidence?.missingCount).toBe(2);
    expect(result.evidence?.filteredTotal).toBe(4);
  });

  it('does not fire at exactly 25% (threshold is strict >)', () => {
    const party = makeParty({
      coHosts: [
        { name: 'A', twitter: 'a_handle' },
        { name: 'B', twitter: 'b_handle' },
        { name: 'C', twitter: 'c_handle' },
        { name: 'D', twitter: null },
      ],
    });
    const result = checkCoHostTwitterHandlesMissing(party);
    expect(result.fired).toBe(false);
    expect(result.evidence?.missingRatio).toBe(0.25);
  });

  it('fires when underboss entry excluded brings ratio above threshold', () => {
    // 4 raw co-hosts, but 1 is isUnderboss → filtered = 3, 1 missing → 33% → fires
    const party = makeParty({
      coHosts: [
        { name: 'A', twitter: 'a_handle' },
        { name: 'B', twitter: 'b_handle' },
        { name: 'C', twitter: null },
        { name: 'D', isUnderboss: true, twitter: null },
      ],
    });
    const result = checkCoHostTwitterHandlesMissing(party);
    expect(result.fired).toBe(true);
    expect(result.evidence?.filteredTotal).toBe(3);
    expect(result.evidence?.missingCount).toBe(1);
  });

  it('does not fire when partner entries (no twitter) are correctly excluded', () => {
    // 5 raw co-hosts: 3 partners without twitter + 2 real with twitter
    // Filtered = 2 real entries, both with twitter → 0/2 missing → doesn't fire.
    const party = makeParty({
      coHosts: [
        { name: 'World Pizza Champions', twitter: null, isPartner: true },
        { name: 'ENS', twitter: null, isPartner: true },
        { name: 'PizzaDAO', twitter: null, isPartner: true },
        { name: 'Real Host A', twitter: 'real_a' },
        { name: 'Real Host B', twitter: 'real_b' },
      ],
    });
    const result = checkCoHostTwitterHandlesMissing(party);
    expect(result.fired).toBe(false);
    expect(result.evidence?.filteredTotal).toBe(2);
    expect(result.evidence?.missingCount).toBe(0);
  });
});

describe('buildSybilWalletSet', () => {
  it('includes wallets with ≥4 parties AND ≥2 distinct names', () => {
    const rows = [
      {
        ethereumAddress: '0xbad',
        partyIds: ['p1', 'p2', 'p3', 'p4'],
        names: ['alice', 'bob'],
      },
      // Only 3 parties — excluded
      {
        ethereumAddress: '0xnotenough',
        partyIds: ['p1', 'p2', 'p3'],
        names: ['x', 'y', 'z'],
      },
      // 4 parties but only 1 name — excluded
      {
        ethereumAddress: '0xsamename',
        partyIds: ['p1', 'p2', 'p3', 'p4'],
        names: ['alice', 'alice'],
      },
    ];
    const set = buildSybilWalletSet(rows);
    expect(set.has('0xbad')).toBe(true);
    expect(set.has('0xnotenough')).toBe(false);
    expect(set.has('0xsamename')).toBe(false);
  });
});

describe('tierFromScore', () => {
  it('maps scores to tiers', () => {
    expect(tierFromScore(0)).toBe('clean');
    expect(tierFromScore(9)).toBe('clean');
    expect(tierFromScore(10)).toBe('low');
    expect(tierFromScore(29)).toBe('low');
    expect(tierFromScore(30)).toBe('medium');
    expect(tierFromScore(59)).toBe('medium');
    expect(tierFromScore(60)).toBe('high');
    expect(tierFromScore(100)).toBe('high');
  });
});

// ============================================
// Integration: "Ilemela-like" vs "Lilongwe-like"
// ============================================

describe('scoreEvent — integration fixtures', () => {
  it('"Ilemela-like" event scores ≥70', () => {
    // Padded event: 95 RSVPs against 100 cap, zero waitlist, one shared domain,
    // identical field signature, no wallets, blank pizzeria fields, single-word
    // names, firstname+digits emails, host-self RSVP under different name,
    // submissions all within one hour, ~30s apart.
    const party = makeParty({
      id: 'ilemela',
      name: 'GPP Ilemela',
      maxGuests: 100,
      timezone: 'Africa/Dar_es_Salaam',
      createdAt: new Date('2026-03-01T10:00:00Z'),
      user: { name: 'Real Host Name', email: 'realhost@example.com' },
    });
    const base = new Date('2026-04-01T12:00:00Z').getTime();
    const guests: FakeDetectionGuest[] = [
      // host self-RSVP with mismatched name, 10s after event creation
      makeGuest({
        name: 'Fake Imposter',
        email: 'fake@imposter.com',
        submittedAt: new Date('2026-03-01T10:00:10Z'),
        walletSource: null,
        pizzeriaRankings: [],
        suggestedPizzerias: [],
        likedToppings: [],
        ethereumAddress: null,
      }),
      ...Array.from({ length: 94 }, (_, i) =>
        makeGuest({
          name: `Name${i}`, // one-word
          email: `mario${i}@spam.com`, // firstname+digits, one domain
          submittedAt: new Date(base + i * 30000), // 30s apart
          walletSource: null,
          pizzeriaRankings: [],
          suggestedPizzerias: [],
          likedToppings: [], // identical signatures
          ethereumAddress: null,
        }),
      ),
    ];
    // Sparse funnel: 5 unique visitors / 95 RSVPs = 5.3% coverage → low_funnel_coverage fires.
    // One visitor lined up at base — temporally matches >=5 of the rapid-fire RSVPs
    // within ±10 min → high_per_visitor_rsvp_saturation fires.
    const funnel: FakeDetectionFunnelEvent[] = [
      makeFunnelEvent({ visitorHash: 'padder', step: 'rsvp_opened', createdAt: new Date(base) }),
      makeFunnelEvent({ visitorHash: 'v1', step: 'rsvp_opened', createdAt: new Date(base) }),
      makeFunnelEvent({ visitorHash: 'v2', step: 'rsvp_opened', createdAt: new Date(base) }),
      makeFunnelEvent({ visitorHash: 'v3', step: 'rsvp_opened', createdAt: new Date(base) }),
      makeFunnelEvent({ visitorHash: 'v4', step: 'rsvp_opened', createdAt: new Date(base) }),
    ];
    const row = scoreEvent(party, guests, [], new Set(), party.maxGuests, funnel);
    // Should fire: 1 cap_fill, 2 low_domain_entropy, 3 sig_collapse,
    // 4a wallet_too_low, 6 host_self, 7 pizzeria_blank, 8 wallet_source_null,
    // 9 one_word_name, 10 firstname_digits, 12 low_hour_entropy, 13 rapid_intersubmission,
    // 15 low_funnel_coverage, 16 high_per_visitor_rsvp_saturation
    expect(row.score).toBeGreaterThanOrEqual(70);
    expect(row.tier).toBe('high');
    const firedIds = row.flags.filter(f => f.fired).map(f => f.id);
    expect(firedIds).toContain('cap_fill_no_waitlist');
    expect(firedIds).toContain('sig_collapse');
    expect(firedIds).toContain('host_self_rsvp_mismatch');
    expect(firedIds).toContain('low_funnel_coverage');
    expect(firedIds).toContain('high_per_visitor_rsvp_saturation');
  });

  it('"Lilongwe-like" clean event scores ≤10', () => {
    // Realistic event: 35 RSVPs, diverse emails, diverse field signatures,
    // healthy wallet ratio, real names, no rapid bursts.
    const party = makeParty({
      id: 'lilongwe',
      name: 'GPP Lilongwe',
      maxGuests: 60,
      timezone: 'Africa/Blantyre',
      createdAt: new Date('2026-03-01T10:00:00Z'),
      user: { name: 'Lilongwe Host', email: 'lilongwe@host.com' },
    });
    const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'protonmail.com', 'icloud.com'];
    const firstNames = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace'];
    const lastNames = ['Banda', 'Phiri', 'Mwale', 'Tembo', 'Nyirenda'];
    const toppingSets = [
      ['mushroom'],
      ['pepperoni', 'olives'],
      ['ham', 'pineapple'],
      ['margherita'],
      ['vegetarian', 'spinach'],
      ['anchovy'],
      ['sausage', 'peppers'],
      ['four-cheese'],
      ['arugula', 'prosciutto'],
      ['basil'],
    ];
    const base = new Date('2026-04-01T12:00:00Z').getTime();
    const guests: FakeDetectionGuest[] = Array.from({ length: 35 }, (_, i) =>
      makeGuest({
        name: `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`,
        email: `${firstNames[i % firstNames.length].toLowerCase()}.${lastNames[i % lastNames.length].toLowerCase()}@${domains[i % domains.length]}`,
        submittedAt: new Date(base + i * 3600000 * 4), // 4 hours apart → spread over days
        walletSource: i % 3 === 0 ? 'privy' : null,
        ethereumAddress: i % 3 === 0 ? `0x${i.toString(16).padStart(40, '0')}` : null,
        likedToppings: toppingSets[i % toppingSets.length],
        pizzeriaRankings: ['da Tonino', 'Pizza Hut'],
        suggestedPizzerias: [{ name: 'Local Pizza' }],
      }),
    );
    // Healthy funnel: 35 RSVPs and 35 distinct visitors (1:1 coverage), each
    // funnel event time-aligned with its own guest → neither funnel flag fires.
    const funnel: FakeDetectionFunnelEvent[] = Array.from({ length: 35 }, (_, i) =>
      makeFunnelEvent({
        visitorHash: `lilongwe-v${i}`,
        step: 'rsvp_opened',
        createdAt: new Date(base + i * 3600000 * 4),
      }),
    );
    const row = scoreEvent(party, guests, [], new Set(), party.maxGuests, funnel);
    expect(row.score).toBeLessThanOrEqual(10);
    expect(row.tier === 'clean' || row.tier === 'low').toBe(true);
    const firedIds = row.flags.filter(f => f.fired).map(f => f.id);
    expect(firedIds).not.toContain('low_funnel_coverage');
    expect(firedIds).not.toContain('high_per_visitor_rsvp_saturation');
  });
});
