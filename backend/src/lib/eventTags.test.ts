import { describe, it, expect } from 'vitest';
import {
  isInternalTag,
  publicTags,
  INTERNAL_EVENT_TAGS,
  withPaidTag,
  withoutPaidTag,
} from './eventTags.js';

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
