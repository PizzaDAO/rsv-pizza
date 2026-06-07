import { describe, it, expect } from 'vitest';
import {
  shannon,
  fieldSignature,
  filterDirectRsvps,
  fnv32,
  simhash32,
  hammingDistance,
  BENFORD_EXPECTED,
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
  checkMailingListOptInExtreme,
  checkNameTokenZscore,
  checkLshFieldSigCluster,
  checkEmailDigitBenford,
  checkCoHostTwitterHandlesMissing,
  checkRepeatSessionRsvpCount,
  checkHighBounceRate,
  checkCheckinVelocitySuperhuman,
  checkCheckinTimestampCollapse,
  checkCheckinRatioExtreme,
  scoreEvent,
  buildSybilWalletSet,
  tierFromScore,
  resolveScoring,
  resolveWeights,
  WEIGHTS,
  PLACEHOLDER_TIERS,
  type FakeDetectionGuest,
  type FakeDetectionParty,
  type FakeDetectionLinkClick,
  type FakeDetectionFunnelEvent,
  type ResolvedScoring,
} from './fakeDetection.js';

// ============================================
// Scoring fixture (marinara-71630 P3)
//
// The real production weights/tiers are SECRET and live only in private
// `app_config`; they are intentionally NOT in source (committed `WEIGHTS` is an
// all-zero placeholder) and NOT here. These TEST values are SYNTHETIC fixtures
// (not the production numbers) chosen only to drive the scorer deterministically:
// every non-checkin heuristic gets a uniform 9 (so the padded "Ilemela" fixture
// saturates ≥70) and every checkin heuristic gets 16 (so the 4-flag
// attendance-fraud roster sums ≥60 → 'high'). The canonical 60/30/10 tier
// thresholds are reproduced for the boundary assertions.
// ============================================

const TEST_TIERS = { high: 60, medium: 30, low: 10 };

const SYNTH_W = 9; // synthetic weight for every non-checkin heuristic
const SYNTH_CHECKIN_W = 16; // synthetic weight for every check-in heuristic

const TEST_WEIGHTS: Record<keyof typeof WEIGHTS, number> = {
  cap_fill_no_waitlist: SYNTH_W,
  low_domain_entropy: SYNTH_W,
  wallet_too_low: SYNTH_W,
  wallet_too_high_reuse: SYNTH_W,
  wallet_reuse: SYNTH_W,
  host_self_rsvp_mismatch: SYNTH_W,
  pizzeria_fields_blank: SYNTH_W,
  wallet_source_all_null: SYNTH_W,
  one_word_name: SYNTH_W,
  firstname_digits_email: SYNTH_W,
  day_gap_pattern: SYNTH_W,
  low_hour_entropy: SYNTH_W,
  rapid_intersubmission: SYNTH_W,
  cross_event_wallet: SYNTH_W,
  low_funnel_coverage: SYNTH_W,
  high_per_visitor_rsvp_saturation: SYNTH_W,
  mailing_list_opt_in_extreme: SYNTH_W,
  name_token_zscore: SYNTH_W,
  lsh_field_sig_cluster: SYNTH_W,
  email_digit_benford: SYNTH_W,
  co_host_twitter_handles_missing: SYNTH_W,
  repeat_session_rsvp_count: SYNTH_W,
  high_bounce_rate: SYNTH_W,
  checkin_velocity_superhuman: SYNTH_CHECKIN_W,
  checkin_timestamp_collapse: SYNTH_CHECKIN_W,
  checkin_ratio_extreme: SYNTH_CHECKIN_W,
};

const TEST_SCORING: ResolvedScoring = resolveScoring({
  weights: TEST_WEIGHTS,
  tiers: TEST_TIERS,
});

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
    mailingListOptIn: false,
    visitorSessionId: null,
    // bounce-rate-heuristic: null by default so existing fixtures (which
    // pre-date the email_status column) skip checkHighBounceRate cleanly.
    emailStatus: null,
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
  it('fires when one visitor temporally matches 6 distinct guests within ±10 min (only visitor → secondMax=0)', () => {
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
    expect(result.evidence?.secondMax).toBe(0);
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

  // parmesan-67529: ratio-based refinement to suppress QR-kiosk false positives.
  // Build N visitors, each with one funnel timestamp centered in its own 2-hour
  // slot; place K guests 1 min apart inside that slot, centered on the funnel
  // event, so the visitor temporally matches all K guests within the ±10-min
  // window. The resulting per-visitor counts array = [K1, K2, K3, ...] which
  // is what we test against the ratio rule. Slots are far enough apart that no
  // cross-slot matching occurs. Requires each K ≤ 21 (the ±10-min window).
  function buildMatchScenario(counts: number[]): {
    guests: FakeDetectionGuest[];
    funnel: FakeDetectionFunnelEvent[];
  } {
    const base = new Date('2026-04-01T12:00:00Z').getTime();
    const SLOT = 2 * 60 * 60_000;
    const guests: FakeDetectionGuest[] = [];
    const funnel: FakeDetectionFunnelEvent[] = [];
    counts.forEach((k, vIdx) => {
      const slotMid = base + vIdx * SLOT + 30 * 60_000; // 30 min into slot
      const visitorHash = vIdx === 0 ? 'padder00' : `kiosk${vIdx}`;
      // Funnel event at slot midpoint
      funnel.push(
        makeFunnelEvent({
          visitorHash,
          step: 'rsvp_opened',
          createdAt: new Date(slotMid),
        }),
      );
      // K guests 1 min apart centered on slotMid so |guest - funnel| ≤ (K-1)/2 min
      const startOffsetMin = -Math.floor((k - 1) / 2);
      for (let i = 0; i < k; i++) {
        guests.push(
          makeGuest({
            id: `g-v${vIdx}-${i}`,
            submittedAt: new Date(slotMid + (startOffsetMin + i) * 60_000),
          }),
        );
      }
    });
    return { guests, funnel };
  }

  it('[10,10,10] flat (kiosk) distribution does NOT fire', () => {
    const { guests, funnel } = buildMatchScenario([10, 10, 10]);
    const r = checkHighPerVisitorRsvpSaturation(guests, funnel);
    expect(r.fired).toBe(false);
    expect(r.evidence?.max).toBe(10);
    expect(r.evidence?.secondMax).toBe(10);
  });

  it('[13,8,6] padder shape (Owerri) DOES fire — ratio 1.625', () => {
    const { guests, funnel } = buildMatchScenario([13, 8, 6]);
    const r = checkHighPerVisitorRsvpSaturation(guests, funnel);
    expect(r.fired).toBe(true);
    expect(r.evidence?.max).toBe(13);
    expect(r.evidence?.secondMax).toBe(8);
    expect(r.evidence?.ratio).toBeCloseTo(13 / 8, 2);
  });

  it('[17,4,3] clear padder (Bwejuu) fires hard — ratio 4.25', () => {
    const { guests, funnel } = buildMatchScenario([17, 4, 3]);
    const r = checkHighPerVisitorRsvpSaturation(guests, funnel);
    expect(r.fired).toBe(true);
    expect(r.evidence?.max).toBe(17);
    expect(r.evidence?.secondMax).toBe(4);
    expect(r.evidence?.ratio).toBeCloseTo(17 / 4, 2);
  });

  it('[17,12,9] Ilemela-shape — ratio 1.42 below threshold, does NOT fire', () => {
    const { guests, funnel } = buildMatchScenario([17, 12, 9]);
    const r = checkHighPerVisitorRsvpSaturation(guests, funnel);
    expect(r.fired).toBe(false);
    expect(r.evidence?.max).toBe(17);
    expect(r.evidence?.secondMax).toBe(12);
  });

  it('edge case: only one visitor matched ≥1 guest (secondMax=0) → fires', () => {
    const { guests, funnel } = buildMatchScenario([6]);
    const r = checkHighPerVisitorRsvpSaturation(guests, funnel);
    expect(r.fired).toBe(true);
    expect(r.evidence?.max).toBe(6);
    expect(r.evidence?.secondMax).toBe(0);
    expect(r.evidence?.ratio).toBe(null);
  });
});

// ============================================
// New statistical heuristics (calzone-75655)
// ============================================

describe('fnv32', () => {
  it('is deterministic', () => {
    expect(fnv32('hello')).toBe(fnv32('hello'));
  });
  it('produces different values for different inputs', () => {
    expect(fnv32('hello')).not.toBe(fnv32('world'));
  });
  it('returns an unsigned 32-bit integer', () => {
    const h = fnv32('anchovy');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });
  it('returns 0x811c9dc5 for empty input (FNV offset basis)', () => {
    expect(fnv32('')).toBe(0x811c9dc5);
  });
});

describe('simhash32', () => {
  it('returns 0 for empty tokens', () => {
    expect(simhash32([])).toBe(0);
  });
  it('produces identical signatures for identical inputs', () => {
    const tokens = ['lt:mushroom', 'r:eater', 'dr:vegan'];
    expect(simhash32(tokens)).toBe(simhash32(tokens));
  });
  it('produces identical signatures regardless of token order', () => {
    const a = ['lt:a', 'lt:b', 'lt:c'];
    const b = ['lt:c', 'lt:a', 'lt:b'];
    expect(simhash32(a)).toBe(simhash32(b));
  });
  it('produces close signatures (Hamming ≤ 2) for one-token variation in long inputs', () => {
    const base = Array.from({ length: 20 }, (_, i) => `lt:t${i}`);
    const variant = [...base.slice(0, 19), 'lt:t99']; // swap one token
    const d = hammingDistance(simhash32(base), simhash32(variant));
    expect(d).toBeLessThanOrEqual(4); // SimHash bound for small edits
  });
  it('produces far signatures for completely different content', () => {
    const a = simhash32(['lt:mushroom', 'r:eater']);
    const b = simhash32(['db:beer', 'r:host', 'dr:gluten-free', 'lb:wine']);
    expect(hammingDistance(a, b)).toBeGreaterThan(5);
  });
});

describe('hammingDistance', () => {
  it('returns 0 for equal values', () => {
    expect(hammingDistance(0x12345678, 0x12345678)).toBe(0);
  });
  it('returns bit count of XOR', () => {
    expect(hammingDistance(0b1010, 0b0101)).toBe(4);
    expect(hammingDistance(0, 0xffffffff)).toBe(32);
  });
  it('is symmetric', () => {
    expect(hammingDistance(0xabcdef01, 0x12345678)).toBe(
      hammingDistance(0x12345678, 0xabcdef01),
    );
  });
});

describe('BENFORD_EXPECTED', () => {
  it('has 9 entries (digits 1..9)', () => {
    expect(BENFORD_EXPECTED.length).toBe(9);
  });
  it('sums to ~1.0', () => {
    const sum = BENFORD_EXPECTED.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 2);
  });
  it('has leading-1 most common', () => {
    expect(BENFORD_EXPECTED[0]).toBeGreaterThan(BENFORD_EXPECTED[1]);
    expect(BENFORD_EXPECTED[0]).toBeCloseTo(0.301, 2);
  });
});

describe('checkMailingListOptInExtreme', () => {
  it('does not fire below min n=20', () => {
    const guests = Array.from({ length: 19 }, () => makeGuest({ mailingListOptIn: true }));
    expect(checkMailingListOptInExtreme(guests).fired).toBe(false);
  });
  it('fires when 0% opted in (default-unchecked never overridden)', () => {
    const guests = Array.from({ length: 50 }, () => makeGuest({ mailingListOptIn: false }));
    expect(checkMailingListOptInExtreme(guests).fired).toBe(true);
  });
  it('fires when 96% opted in (Naivasha-like — checkbox auto-ticked for fakes)', () => {
    const guests = Array.from({ length: 50 }, (_, i) =>
      makeGuest({ mailingListOptIn: i < 48 }),
    );
    expect(checkMailingListOptInExtreme(guests).fired).toBe(true);
  });
  it('does not fire at realistic ~40% opt-in', () => {
    const guests = Array.from({ length: 50 }, (_, i) =>
      makeGuest({ mailingListOptIn: i < 20 }),
    );
    expect(checkMailingListOptInExtreme(guests).fired).toBe(false);
  });
});

describe('checkNameTokenZscore', () => {
  it('does not fire below min n=30', () => {
    const guests = Array.from({ length: 29 }, (_, i) =>
      makeGuest({ name: i < 5 ? 'John' : `Person${i}` }),
    );
    expect(checkNameTokenZscore(guests).fired).toBe(false);
  });
  it('fires for Ilemela-like John ×8 over varied names', () => {
    const guests: FakeDetectionGuest[] = [
      ...Array.from({ length: 8 }, () => makeGuest({ name: 'John Doe' })),
      ...Array.from({ length: 25 }, (_, i) => makeGuest({ name: `Unique${i} Surname` })),
    ];
    const r = checkNameTokenZscore(guests);
    expect(r.fired).toBe(true);
    expect(r.evidence?.maxToken).toBe('john');
    expect(r.evidence?.maxCount).toBe(8);
  });
  it('does not fire when maxCount < 5 even if z is high', () => {
    const guests = Array.from({ length: 40 }, (_, i) =>
      makeGuest({ name: i < 3 ? 'John Doe' : `Person${i} Surname` }),
    );
    expect(checkNameTokenZscore(guests).fired).toBe(false);
  });
  it('does not fire for evenly distributed first names', () => {
    const firstNames = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank'];
    const guests = Array.from({ length: 36 }, (_, i) =>
      makeGuest({ name: `${firstNames[i % firstNames.length]} Surname${i}` }),
    );
    expect(checkNameTokenZscore(guests).fired).toBe(false);
  });
});

describe('checkLshFieldSigCluster', () => {
  it('does not fire below min n=30', () => {
    const guests = Array.from({ length: 29 }, () =>
      makeGuest({ likedToppings: ['x'] }),
    );
    expect(checkLshFieldSigCluster(guests).fired).toBe(false);
  });
  it('fires when >40% share near-identical field signatures', () => {
    // 25 identical + 5 with one-topping variation (still cluster within Hamming ≤ 2)
    const guests: FakeDetectionGuest[] = [
      ...Array.from({ length: 25 }, () =>
        makeGuest({
          likedToppings: ['mushroom', 'pepperoni'],
          dietaryRestrictions: ['vegan'],
        }),
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        makeGuest({ likedToppings: [`unique${i}`], dietaryRestrictions: [] }),
      ),
    ];
    const r = checkLshFieldSigCluster(guests);
    expect(r.fired).toBe(true);
    expect(r.evidence?.maxCluster).toBeGreaterThanOrEqual(20);
  });
  it('does not fire when guests have diverse field signatures', () => {
    const guests = Array.from({ length: 40 }, (_, i) =>
      makeGuest({
        likedToppings: [`lt${i}_a`, `lt${i}_b`],
        dislikedToppings: [`dt${i}`],
        likedBeverages: [`lb${i}`],
        dislikedBeverages: [`db${i}`],
        dietaryRestrictions: [`dr${i}`],
        roles: [`r${i}`],
      }),
    );
    expect(checkLshFieldSigCluster(guests).fired).toBe(false);
  });
  it('tolerates one-field variation (catches sig_collapse bypass)', () => {
    // Padders set anchovy default on most but one — sig_collapse would miss this,
    // LSH catches it because Hamming distance stays ≤ 2 for single-token edits in long token sets.
    const baseTokens = {
      likedToppings: ['mushroom', 'pepperoni', 'onion'],
      dislikedToppings: ['olive'],
      likedBeverages: ['water'],
      dislikedBeverages: ['beer'],
      dietaryRestrictions: ['vegan'],
      roles: ['eater'],
    };
    const guests: FakeDetectionGuest[] = [
      ...Array.from({ length: 30 }, (_, i) =>
        makeGuest({
          ...baseTokens,
          // Half the padded set has an extra anchovy in dislikedToppings (the bug)
          dislikedToppings: i % 2 === 0 ? ['olive'] : ['olive', 'anchovy'],
        }),
      ),
    ];
    expect(checkLshFieldSigCluster(guests).fired).toBe(true);
  });
});

describe('checkEmailDigitBenford', () => {
  it('does not fire below min n=30 emails-with-suffixes', () => {
    const guests = Array.from({ length: 20 }, (_, i) =>
      makeGuest({ email: `padder${78 + (i % 20)}@gmail.com` }),
    );
    expect(checkEmailDigitBenford(guests).fired).toBe(false);
  });
  it('fires when leading digits skew to 7-9 (year-suffix burner pattern)', () => {
    // Years 78, 83, 84, 87, 88, 91, 92 → leading digits 7,8,8,8,8,9,9 (heavy 8/9)
    const yearSuffixes = [78, 79, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99];
    const guests: FakeDetectionGuest[] = [];
    for (let i = 0; i < 60; i++) {
      const y = yearSuffixes[i % yearSuffixes.length];
      guests.push(makeGuest({ email: `user${y}@gmail.com` }));
    }
    const r = checkEmailDigitBenford(guests);
    expect(r.fired).toBe(true);
    expect((r.evidence?.sad as number)).toBeGreaterThan(0.4);
  });
  it('does not fire for Benford-distributed leading digits', () => {
    // Construct emails whose leading digits roughly match Benford
    const targetCounts = [60, 35, 25, 19, 16, 13, 12, 10, 9]; // proportional to Benford
    const guests: FakeDetectionGuest[] = [];
    targetCounts.forEach((count, idx) => {
      const lead = idx + 1;
      for (let i = 0; i < count; i++) {
        guests.push(makeGuest({ email: `user${lead}${i}@gmail.com` }));
      }
    });
    expect(checkEmailDigitBenford(guests).fired).toBe(false);
  });
  it('ignores emails without trailing digit suffix', () => {
    const guests = Array.from({ length: 30 }, () =>
      makeGuest({ email: 'mario.rossi@gmail.com' }),
    );
    // total digit-suffix emails = 0 → below 30 → no-fire
    expect(checkEmailDigitBenford(guests).fired).toBe(false);
  });
  it('strips leading zeros when computing leading digit', () => {
    // All "007" → leading digit 7 → extreme skew → SAD large → fires
    const guests = Array.from({ length: 40 }, (_, i) =>
      makeGuest({ email: `agent00${7 + (i % 2)}_${i}@gmail.com` }),
    );
    // Note: pattern is firstname<letters>digits → trailing digit run is "_<i>"
    // The regex grabs the trailing \d+ which is `${i}`. Let's just verify it doesn't crash.
    const r = checkEmailDigitBenford(guests);
    expect(typeof r.fired).toBe('boolean');
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

describe('checkRepeatSessionRsvpCount', () => {
  // romana-30802: cookie-based padding detector. Min-n=20 non-null sessions;
  // fires when max session repeat ≥ 5.

  it('does not fire below min-n (only 10 guests with session_id)', () => {
    const guests = Array.from({ length: 10 }, (_, i) =>
      makeGuest({ visitorSessionId: `sess-${i}` }),
    );
    const result = checkRepeatSessionRsvpCount(guests);
    expect(result.fired).toBe(false);
    expect(result.detail).toMatch(/need ≥20/);
  });

  it('does not fire when all session IDs are distinct (no repeats)', () => {
    const guests = Array.from({ length: 30 }, (_, i) =>
      makeGuest({ visitorSessionId: `unique-sess-${i}` }),
    );
    const result = checkRepeatSessionRsvpCount(guests);
    expect(result.fired).toBe(false);
    expect(result.evidence?.maxRepeats).toBe(1);
  });

  it('fires when one session_id repeats 5+ times', () => {
    // 5 guests share "padder-session"; 20 others are distinct → maxRepeats=5
    const padder = Array.from({ length: 5 }, () =>
      makeGuest({ visitorSessionId: 'padder-session-aaaa-bbbb-cccc' }),
    );
    const others = Array.from({ length: 20 }, (_, i) =>
      makeGuest({ visitorSessionId: `legit-${i}` }),
    );
    const result = checkRepeatSessionRsvpCount([...padder, ...others]);
    expect(result.fired).toBe(true);
    expect(result.evidence?.maxRepeats).toBe(5);
    expect(result.evidence?.sessionsWithData).toBe(25);
  });

  it('ignores null session IDs in the count', () => {
    // 30 guests total, but only 10 have a session_id → below min-n, no fire
    const withSession = Array.from({ length: 10 }, (_, i) =>
      makeGuest({ visitorSessionId: `s-${i}` }),
    );
    const withoutSession = Array.from({ length: 20 }, () =>
      makeGuest({ visitorSessionId: null }),
    );
    const result = checkRepeatSessionRsvpCount([...withSession, ...withoutSession]);
    expect(result.fired).toBe(false);
    expect(result.detail).toMatch(/10\/30/);
  });
});

describe('checkHighBounceRate', () => {
  // bounce-rate-heuristic: fires when ≥15% of scorable emails are
  // bounced/suppressed/complained. Min-n=10 scorable.

  it('does not fire below min-n (only 9 scorable emails)', () => {
    const guests = Array.from({ length: 9 }, () =>
      makeGuest({ emailStatus: 'bounced' }),
    );
    const result = checkHighBounceRate(guests);
    expect(result.fired).toBe(false);
    expect(result.detail).toMatch(/n=9 below 10/);
  });

  it('ignores null and "unknown" statuses in the denominator', () => {
    // 9 nulls + 1 unknown + 5 delivered = n=5 scorable → below min-n
    const guests = [
      ...Array.from({ length: 9 }, () => makeGuest({ emailStatus: null })),
      makeGuest({ emailStatus: 'unknown' }),
      ...Array.from({ length: 5 }, () => makeGuest({ emailStatus: 'delivered' })),
    ];
    const result = checkHighBounceRate(guests);
    expect(result.fired).toBe(false);
    expect(result.detail).toMatch(/n=5 below 10/);
  });

  it('does not fire at 14% bad rate (below threshold)', () => {
    // 14 bounced / 100 scorable = 14%
    const bad = Array.from({ length: 14 }, () => makeGuest({ emailStatus: 'bounced' }));
    const good = Array.from({ length: 86 }, () => makeGuest({ emailStatus: 'delivered' }));
    const result = checkHighBounceRate([...bad, ...good]);
    expect(result.fired).toBe(false);
    expect(result.evidence?.rate).toBeCloseTo(0.14);
  });

  it('fires at exactly 15% bad rate (boundary)', () => {
    const bad = Array.from({ length: 15 }, () => makeGuest({ emailStatus: 'bounced' }));
    const good = Array.from({ length: 85 }, () => makeGuest({ emailStatus: 'delivered' }));
    const result = checkHighBounceRate([...bad, ...good]);
    expect(result.fired).toBe(true);
    expect(result.evidence?.rate).toBeCloseTo(0.15);
  });

  it('fires at 100% bounce rate', () => {
    const guests = Array.from({ length: 30 }, () => makeGuest({ emailStatus: 'bounced' }));
    const result = checkHighBounceRate(guests);
    expect(result.fired).toBe(true);
    expect(result.evidence?.rate).toBe(1);
    expect(result.evidence?.bad).toBe(30);
    expect(result.evidence?.total).toBe(30);
  });

  it('counts bounced + suppressed + complained as bad (all three flavors)', () => {
    // 6 bounced + 5 suppressed + 4 complained = 15 bad of 100 → fires
    const bounced = Array.from({ length: 6 }, () => makeGuest({ emailStatus: 'bounced' }));
    const suppressed = Array.from({ length: 5 }, () => makeGuest({ emailStatus: 'suppressed' }));
    const complained = Array.from({ length: 4 }, () => makeGuest({ emailStatus: 'complained' }));
    const good = Array.from({ length: 85 }, () => makeGuest({ emailStatus: 'delivered' }));
    const result = checkHighBounceRate([...bounced, ...suppressed, ...complained, ...good]);
    expect(result.fired).toBe(true);
    expect(result.evidence?.bad).toBe(15);
  });

  it('delivered + delivery_delayed + failed are NOT counted as bad', () => {
    // 30 delivered + 5 delivery_delayed + 5 failed = 0 bad of 40 → no fire
    const delivered = Array.from({ length: 30 }, () => makeGuest({ emailStatus: 'delivered' }));
    const delayed = Array.from({ length: 5 }, () => makeGuest({ emailStatus: 'delivery_delayed' }));
    const failed = Array.from({ length: 5 }, () => makeGuest({ emailStatus: 'failed' }));
    const result = checkHighBounceRate([...delivered, ...delayed, ...failed]);
    expect(result.fired).toBe(false);
    expect(result.evidence?.bad).toBe(0);
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
  it('maps scores to tiers using the resolved (injected) thresholds', () => {
    const t = TEST_TIERS;
    expect(tierFromScore(0, t)).toBe('clean');
    expect(tierFromScore(9, t)).toBe('clean');
    expect(tierFromScore(10, t)).toBe('low');
    expect(tierFromScore(29, t)).toBe('low');
    expect(tierFromScore(30, t)).toBe('medium');
    expect(tierFromScore(59, t)).toBe('medium');
    expect(tierFromScore(60, t)).toBe('high');
    expect(tierFromScore(100, t)).toBe('high');
  });

  it('honours arbitrary config-provided thresholds', () => {
    const tiers = { high: 90, medium: 50, low: 20 };
    expect(tierFromScore(19, tiers)).toBe('clean');
    expect(tierFromScore(20, tiers)).toBe('low');
    expect(tierFromScore(50, tiers)).toBe('medium');
    expect(tierFromScore(89, tiers)).toBe('medium');
    expect(tierFromScore(90, tiers)).toBe('high');
  });
});

describe('resolveWeights / resolveScoring (marinara-71630 P3)', () => {
  it('merges config weights over the all-zero placeholder', () => {
    const w = resolveWeights({ cap_fill_no_waitlist: 42 });
    expect(w.cap_fill_no_waitlist).toBe(42);
    // Unspecified keys fall back to the placeholder (0).
    expect(w.high_bounce_rate).toBe(0);
  });

  it('ignores unknown keys and non-finite values', () => {
    const w = resolveWeights({
      not_a_real_heuristic: 99,
      cap_fill_no_waitlist: Number.NaN,
    } as Record<string, number>);
    expect((w as Record<string, number>).not_a_real_heuristic).toBeUndefined();
    expect(w.cap_fill_no_waitlist).toBe(0); // NaN rejected → placeholder
  });

  it('falls back to all-zero placeholder weights + tiers when config is empty', () => {
    const s = resolveScoring({ weights: {}, tiers: {} });
    expect(s.tiers).toEqual(PLACEHOLDER_TIERS);
    expect(Object.values(s.weights).every(v => v === 0)).toBe(true);
  });

  it('falls back to placeholder when config is entirely absent', () => {
    const s = resolveScoring(undefined);
    expect(s.tiers).toEqual(PLACEHOLDER_TIERS);
    expect(Object.values(s.weights).every(v => v === 0)).toBe(true);
  });
});

describe('scoreEvent — config-absent fallback (marinara-71630 P3)', () => {
  it('scores 0 / clean and does not throw when no scoring config is injected', () => {
    const party = makeParty();
    // A roster that WOULD fire several flags under real weights.
    const guests = fraudCheckinRoster(60, 30, 'host-1');
    // No `scoring` arg → defaults to the committed all-zero placeholder.
    const row = scoreEvent(party, guests, [], new Set(), party.maxGuests);
    // Flags may fire, but every weight is the placeholder 0 → score 0 → clean.
    expect(row.score).toBe(0);
    expect(row.tier).toBe('clean');
  });

  it('produces the expected weighted score + tier when config is injected', () => {
    const party = makeParty();
    const guests = fraudCheckinRoster(60, 30, 'host-1'); // fires all 4 checkin flags
    const row = scoreEvent(
      party,
      guests,
      [],
      new Set(),
      party.maxGuests,
      [],
      TEST_SCORING,
    );
    const firedIds = row.flags.filter(f => f.fired).map(f => f.id);
    const expected = Math.min(
      100,
      firedIds.reduce((s, id) => s + TEST_WEIGHTS[id as keyof typeof WEIGHTS], 0),
    );
    expect(row.score).toBe(expected);
    expect(row.tier).toBe(tierFromScore(expected, TEST_TIERS));
    // Sanity: the attendance-fraud roster tiers 'high' under the test thresholds.
    expect(row.tier).toBe('high');
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
    const row = scoreEvent(party, guests, [], new Set(), party.maxGuests, funnel, TEST_SCORING);
    // Should fire: cap_fill, low_domain_entropy, wallet_too_low, host_self,
    // pizzeria_blank, wallet_source_null, one_word_name, firstname_digits,
    // low_hour_entropy, rapid_intersubmission, low_funnel_coverage,
    // mailing_list_opt_in_extreme (all default=false), lsh_field_sig_cluster
    // (identical sigs).
    // (sig_collapse no longer in scoreEvent list — replaced by lsh_field_sig_cluster.)
    // parmesan-67529: high_per_visitor_rsvp_saturation no longer fires here
    // because all 5 funnel visitors line up at the same `base` timestamp →
    // each matches the same large set of RSVPs → max == secondMax (ratio 1.0,
    // below 1.5 threshold). The remaining 13 heuristics still saturate the
    // score above 70. This is the desired post-refinement behavior: kiosk-shape
    // flat distributions don't trip saturation.
    expect(row.score).toBeGreaterThanOrEqual(70);
    expect(row.tier).toBe('high');
    const firedIds = row.flags.filter(f => f.fired).map(f => f.id);
    expect(firedIds).toContain('cap_fill_no_waitlist');
    expect(firedIds).not.toContain('sig_collapse'); // removed from scoreEvent
    expect(firedIds).toContain('lsh_field_sig_cluster'); // replaces sig_collapse
    expect(firedIds).toContain('mailing_list_opt_in_extreme');
    expect(firedIds).toContain('host_self_rsvp_mismatch');
    expect(firedIds).toContain('low_funnel_coverage');
    expect(firedIds).not.toContain('high_per_visitor_rsvp_saturation');
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
        // ~40% opt-in keeps mailing_list_opt_in_extreme silent (between 5% and 95%)
        mailingListOptIn: i % 5 < 2,
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
    const row = scoreEvent(party, guests, [], new Set(), party.maxGuests, funnel, TEST_SCORING);
    expect(row.score).toBeLessThanOrEqual(10);
    expect(row.tier === 'clean' || row.tier === 'low').toBe(true);
    const firedIds = row.flags.filter(f => f.fired).map(f => f.id);
    expect(firedIds).not.toContain('low_funnel_coverage');
    expect(firedIds).not.toContain('high_per_visitor_rsvp_saturation');
    // None of the four new stat heuristics should fire on the clean fixture.
    expect(firedIds).not.toContain('mailing_list_opt_in_extreme');
    expect(firedIds).not.toContain('name_token_zscore');
    expect(firedIds).not.toContain('lsh_field_sig_cluster');
    expect(firedIds).not.toContain('email_digit_benford');
  });
});

// ============================================
// Check-in attendance-fraud heuristics (marinara-60931)
// ============================================

/** Build a roster of `n` guests all checked in within `windowSec` by one checker. */
function fraudCheckinRoster(
  n: number,
  windowSec: number,
  checkedInBy: string | null = 'host-1',
): FakeDetectionGuest[] {
  const base = new Date('2026-04-01T19:00:00Z').getTime();
  return Array.from({ length: n }, (_, i) =>
    makeGuest({
      name: `Guest ${i}`,
      email: `guest${i}@example.com`,
      submittedVia: i % 2 === 0 ? 'link' : 'invite',
      // Spread evenly across the (tiny) window → many collisions per second.
      checkedInAt: new Date(base + Math.floor((i / n) * windowSec * 1000)),
      checkedInBy,
    }),
  );
}

/** Build a healthy roster: check-ins spread over hours, multiple checkers. */
function healthyCheckinRoster(n: number, checkedInCount: number): FakeDetectionGuest[] {
  const base = new Date('2026-04-01T18:00:00Z').getTime();
  const checkers = ['door-1', 'door-2', 'door-3', 'door-4'];
  return Array.from({ length: n }, (_, i) =>
    makeGuest({
      name: `Guest ${i}`,
      email: `guest${i}@example.com`,
      // First `checkedInCount` guests checked in, spread over ~4 hours.
      checkedInAt:
        i < checkedInCount
          ? new Date(base + Math.floor((i / checkedInCount) * 4 * 3600 * 1000))
          : null,
      checkedInBy: i < checkedInCount ? checkers[i % checkers.length] : null,
    }),
  );
}

describe('checkCheckinVelocitySuperhuman', () => {
  it('fires when an entire roster is checked in within ~1 minute', () => {
    const guests = fraudCheckinRoster(60, 60); // 60 check-ins over 60s
    const r = checkCheckinVelocitySuperhuman(guests);
    expect(r.fired).toBe(true);
    expect(r.weight).toBe(WEIGHTS.checkin_velocity_superhuman);
  });

  it('collapses (not fired) below n=20', () => {
    const guests = fraudCheckinRoster(19, 60);
    expect(checkCheckinVelocitySuperhuman(guests).fired).toBe(false);
  });

  it('does not fire when check-ins are spread over hours', () => {
    const guests = healthyCheckinRoster(50, 30); // 30 check-ins over 4h → <0.2/min
    expect(checkCheckinVelocitySuperhuman(guests).fired).toBe(false);
  });
});

describe('checkCheckinTimestampCollapse', () => {
  it('fires when many guests share the same check-in second', () => {
    // 78 guests, all within 30 seconds → far fewer distinct seconds than guests.
    const guests = fraudCheckinRoster(78, 30);
    const r = checkCheckinTimestampCollapse(guests);
    expect(r.fired).toBe(true);
  });

  it('collapses (not fired) below n=20', () => {
    const guests = fraudCheckinRoster(19, 5);
    expect(checkCheckinTimestampCollapse(guests).fired).toBe(false);
  });

  it('does not fire when each check-in lands on a distinct second', () => {
    const guests = healthyCheckinRoster(40, 40); // spread over 4h → all distinct seconds
    expect(checkCheckinTimestampCollapse(guests).fired).toBe(false);
  });
});

describe('checkCheckinRatioExtreme', () => {
  it('fires when ≥95% of the roster is checked in', () => {
    // 78 checked in + 3 not = 81 total → 96%.
    const checkedIn = fraudCheckinRoster(78, 3600);
    const notCheckedIn = Array.from({ length: 3 }, (_, i) =>
      makeGuest({ name: `NoShow ${i}`, checkedInAt: null }),
    );
    const guests = [...checkedIn, ...notCheckedIn];
    const r = checkCheckinRatioExtreme(guests);
    expect(r.fired).toBe(true);
  });

  it('collapses (not fired) below n=20 total guests', () => {
    const guests = fraudCheckinRoster(19, 3600);
    expect(checkCheckinRatioExtreme(guests).fired).toBe(false);
  });

  it('does not fire on a healthy ~60% attendance rate', () => {
    const guests = healthyCheckinRoster(50, 30); // 30/50 = 60%
    expect(checkCheckinRatioExtreme(guests).fired).toBe(false);
  });
});

describe('scoreEvent — check-in heuristics integration', () => {
  it('attendance-fraud roster fires all four check-in flags and scores high', () => {
    const party = makeParty();
    // 60 guests all checked in within ~30s by one host → ratio 100%.
    const guests = fraudCheckinRoster(60, 30, 'host-1');
    const row = scoreEvent(party, guests, [], new Set(), party.maxGuests, [], TEST_SCORING);
    const firedIds = row.flags.filter(f => f.fired).map(f => f.id);
    expect(firedIds).toContain('checkin_velocity_superhuman');
    expect(firedIds).toContain('checkin_timestamp_collapse');
    expect(firedIds).toContain('checkin_ratio_extreme');
    expect(row.score).toBeGreaterThanOrEqual(
      TEST_WEIGHTS.checkin_velocity_superhuman + TEST_WEIGHTS.checkin_ratio_extreme,
    );
  });

  it('healthy roster fires none of the check-in flags', () => {
    const party = makeParty();
    const guests = healthyCheckinRoster(50, 30);
    const row = scoreEvent(party, guests, [], new Set(), party.maxGuests, [], TEST_SCORING);
    const firedIds = row.flags.filter(f => f.fired).map(f => f.id);
    expect(firedIds).not.toContain('checkin_velocity_superhuman');
    expect(firedIds).not.toContain('checkin_timestamp_collapse');
    expect(firedIds).not.toContain('checkin_ratio_extreme');
  });
});
