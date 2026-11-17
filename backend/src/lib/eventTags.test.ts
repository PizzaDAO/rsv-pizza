import { describe, it, expect } from 'vitest';
import {
  isInternalTag,
  publicTags,
  INTERNAL_EVENT_TAGS,
  withPaidTag,
  withoutPaidTag,
  INTERNAL_TAG_PATTERNS,
  mergeHostEventTags,
  HOST_WRITABLE_EVENT_TAGS,
} from './eventTags.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('isInternalTag', () => {
  it('flags the known internal control tags', () => {
    for (const t of ['possible-scam', 'paid', 'prepay', 'go', 'nonpres', 'missed', 'nonhub']) {
      expect(isInternalTag(t)).toBe(true);
    }
  });

  it('is case-insensitive for known tags', () => {
    expect(isInternalTag('PAID')).toBe(true);
    expect(isInternalTag('NonHub')).toBe(true);
  });

  it('trims whitespace', () => {
    expect(isInternalTag('  paid  ')).toBe(true);
  });

  it('flags numeric reimbursement-cap tags', () => {
    expect(isInternalTag('500')).toBe(true);
    expect(isInternalTag('450.00')).toBe(true);
    expect(isInternalTag('350.5')).toBe(true);
  });

  it('flags the gpp2027 pre-launch gate marker (any case)', () => {
    expect(isInternalTag('gpp2027')).toBe(true);
    expect(isInternalTag('GPP2027')).toBe(true);
  });

  it('does NOT flag public season/program tags', () => {
    for (const t of ['swc', 'swcbr', 'SWC Hub', 'wpc', 'ens', 'Global Pizza Party', 'gpp2026']) {
      expect(isInternalTag(t)).toBe(false);
    }
  });

  it('does NOT flag non-string input', () => {
    // @ts-expect-error runtime guard
    expect(isInternalTag(null)).toBe(false);
    // @ts-expect-error runtime guard
    expect(isInternalTag(42)).toBe(false);
  });
});

describe('publicTags', () => {
  it('strips internal tags and keeps public ones', () => {
    const input = [
      // internal — should be stripped
      'possible-scam', 'paid', 'prepay', 'go', 'nonpres', 'missed', 'nonhub',
      '500', '450.00', 'gpp2027',
      // public — should survive
      'swc', 'swcbr', 'SWC Hub', 'wpc', 'ens', 'Global Pizza Party', 'gpp2026',
    ];
    expect(publicTags(input)).toEqual([
      'swc', 'swcbr', 'SWC Hub', 'wpc', 'ens', 'Global Pizza Party', 'gpp2026',
    ]);
  });

  it('returns [] for null', () => {
    expect(publicTags(null)).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(publicTags(undefined)).toEqual([]);
  });

  it('returns [] for a non-array', () => {
    // @ts-expect-error runtime guard
    expect(publicTags('paid')).toEqual([]);
  });

  it('returns [] for an empty array', () => {
    expect(publicTags([])).toEqual([]);
  });

  it('preserves order of surviving tags', () => {
    expect(publicTags(['gpp2026', 'paid', 'swc'])).toEqual(['gpp2026', 'swc']);
  });
});

// calzone-50114 Part B: the 'paid' close-out tag logic used by the
// admin-payout mark-paid / reopen handlers.
describe('withPaidTag (close-out)', () => {
  it('appends paid when absent', () => {
    expect(withPaidTag(['gpp2026', 'swc'])).toEqual(['gpp2026', 'swc', 'paid']);
  });

  it('is idempotent when already paid', () => {
    expect(withPaidTag(['gpp2026', 'paid'])).toEqual(['gpp2026', 'paid']);
    // repeated close-out does not duplicate the tag
    expect(withPaidTag(withPaidTag(['swc']))).toEqual(['swc', 'paid']);
  });

  it('handles null/undefined/empty by producing just paid', () => {
    expect(withPaidTag(null)).toEqual(['paid']);
    expect(withPaidTag(undefined)).toEqual(['paid']);
    expect(withPaidTag([])).toEqual(['paid']);
  });
});

describe('withoutPaidTag (re-open)', () => {
  it('removes the paid tag, preserving others', () => {
    expect(withoutPaidTag(['gpp2026', 'paid', 'swc'])).toEqual(['gpp2026', 'swc']);
  });

  it('is a no-op when paid absent', () => {
    expect(withoutPaidTag(['gpp2026', 'swc'])).toEqual(['gpp2026', 'swc']);
  });

  it('handles null/undefined/empty', () => {
    expect(withoutPaidTag(null)).toEqual([]);
    expect(withoutPaidTag(undefined)).toEqual([]);
    expect(withoutPaidTag([])).toEqual([]);
  });

  it('round-trips: close-out then re-open restores original (paid absent)', () => {
    const original = ['gpp2026', 'swc'];
    expect(withoutPaidTag(withPaidTag(original))).toEqual(original);
  });
});

describe('INTERNAL_EVENT_TAGS export', () => {
  it('contains the documented control tags', () => {
    expect(INTERNAL_EVENT_TAGS.has('nonhub')).toBe(true);
    expect(INTERNAL_EVENT_TAGS.has('possible-scam')).toBe(true);
  });
});

import { changesGuardedTags } from './eventTags.js';

describe('changesGuardedTags (host cannot clear scam flag or mint a cap)', () => {
  it('detects removing possible-scam, adding numeric/k caps, case-insensitively', () => {
    expect(changesGuardedTags(['possible-scam', 'gpp2026'], ['gpp2026'])).toBe(true);
    expect(changesGuardedTags(['x'], ['x', 'possible-scam'])).toBe(true);
    expect(changesGuardedTags(['x'], ['x', '500'])).toBe(true);
    expect(changesGuardedTags(['200'], ['350.50'])).toBe(true);
    expect(changesGuardedTags(['x'], ['x', 'K40'])).toBe(true);
    expect(changesGuardedTags(['Possible-Scam'], [])).toBe(true);
  });
  it('allows unrelated and unchanged tag edits', () => {
    expect(changesGuardedTags(['possible-scam', '200'], ['200', 'possible-scam', 'swc'])).toBe(false);
    expect(changesGuardedTags([], ['swc', 'gpp2026'])).toBe(false);
    expect(changesGuardedTags(null, [])).toBe(false);
  });
});

describe('blackolive-70521: parity with scripts/internal-event-tags.json (frontend mirror)', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(__dirname, '../../../scripts/internal-event-tags.json'), 'utf8'),
  );
  it('INTERNAL_EVENT_TAGS matches the fixture', () => {
    expect([...INTERNAL_EVENT_TAGS].sort()).toEqual(fixture.tags);
  });
  it('INTERNAL_TAG_PATTERNS matches the fixture', () => {
    expect(INTERNAL_TAG_PATTERNS.map((r) => ({ source: r.source, flags: r.flags }))).toEqual(
      fixture.patterns,
    );
  });
});

describe('blackolive-70521: mergeHostEventTags', () => {
  it('HOST_WRITABLE is just prepay', () => {
    expect([...HOST_WRITABLE_EVENT_TAGS]).toEqual(['prepay']);
  });
  it('adds and removes prepay', () => {
    expect(mergeHostEventTags(['swc'], ['swc', 'prepay']).tags).toEqual(['swc', 'prepay']);
    expect(mergeHostEventTags(['swc', 'prepay'], ['swc']).tags).toEqual(['swc']);
  });
  it('preserves other tags and ignores adds/removes', () => {
    const r = mergeHostEventTags(['nonhub', 'swc'], ['paid', 'gpp2027', 'side-prelaunch']);
    expect(r.tags).toEqual(['nonhub', 'swc']);
    expect(r.ignoredAdded).toEqual(['paid', 'gpp2027', 'side-prelaunch']);
    expect(r.ignoredRemoved).toEqual(['nonhub', 'swc']);
    expect(r.changed).toBe(false);
  });
  it('only ever stores canonical prepay, deduped', () => {
    const r = mergeHostEventTags(['swc'], ['swc', 'PREPAY', ' prepay', 'prepay ']);
    expect(r.tags).toEqual(['swc', 'prepay']);
  });
  it('canonicalizes a stored variant and dedupes stored duplicates', () => {
    const r = mergeHostEventTags(['PREPAY', 'swc', 'prepay '], ['swc', 'prepay']);
    expect(r.tags).toEqual(['prepay', 'swc']);
  });
  it('case/whitespace variants of protected tags are not host-writable', () => {
    const r = mergeHostEventTags(['swc'], ['swc', 'PAID', ' Go ', 'NonHub']);
    expect(r.tags).toEqual(['swc']);
    expect(r.ignoredAdded).toEqual(['PAID', ' Go ', 'NonHub']);
  });
  it('ignores non-string entries', () => {
    const r = mergeHostEventTags(['swc'], ['swc', 5, null, undefined, { a: 1 }, 'prepay']);
    expect(r.tags).toEqual(['swc', 'prepay']);
    expect(r.ignoredAdded).toEqual([]);
  });
  it('handles null/undefined current and empty request', () => {
    expect(mergeHostEventTags(null, ['prepay']).tags).toEqual(['prepay']);
    expect(mergeHostEventTags(undefined, []).tags).toEqual([]);
  });
  it('dedupes repeated ignored adds', () => {
    expect(mergeHostEventTags([], ['paid', 'paid']).ignoredAdded).toEqual(['paid']);
  });
  it('partial array without protected tags keeps them (full vs partial)', () => {
    const cur = ['swc', 'nonhub', 'refund', 'prepay'];
    expect(mergeHostEventTags(cur, ['prepay']).tags).toEqual(['swc', 'nonhub', 'refund', 'prepay']);
    expect(mergeHostEventTags(cur, cur).changed).toBe(false);
  });
  it('hidden refund (filtered by the host client) is preserved on a prepay toggle', () => {
    const r = mergeHostEventTags(['swc', 'refund'], ['swc', 'prepay']); // client never saw refund
    expect(r.tags).toEqual(['swc', 'refund', 'prepay']);
    expect(mergeHostEventTags(['swc', 'refund', 'prepay'], ['swc']).tags).toEqual(['swc', 'refund']);
  });
});
