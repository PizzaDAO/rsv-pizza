import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { EVENT_LABEL_KEYS, MAX_EVENT_LABELS, normalizeLabels, exceedsMaxLabels } from './eventLabels.js';
import { isInternalTag, isGuardedTag, INTERNAL_EVENT_TAGS } from './eventTags.js';

describe('normalizeLabels', () => {
  it('trims, lowercases, dedupes and drops unknown keys', () => {
    expect(normalizeLabels([' DJ ', 'dj', 'Outdoor', 'bogus', 42, null])).toEqual(['outdoor', 'dj']);
  });
  it('returns allowlist order regardless of input order', () => {
    expect(normalizeLabels(['gaming', 'family-friendly', 'dj'])).toEqual(['family-friendly', 'dj', 'gaming']);
  });
  it('non-arrays give an empty list', () => {
    expect(normalizeLabels(undefined)).toEqual([]);
    expect(normalizeLabels('dj')).toEqual([]);
  });
  it('detects over the max', () => {
    expect(MAX_EVENT_LABELS).toBe(5);
    expect(exceedsMaxLabels(EVENT_LABEL_KEYS.slice(0, 5))).toBe(false);
    expect(exceedsMaxLabels(EVENT_LABEL_KEYS.slice(0, 6))).toBe(true);
  });
});

describe('EVENT_LABEL_KEYS', () => {
  it('matches scripts/event-labels.json', () => {
    const json = JSON.parse(readFileSync(resolve(__dirname, '../../../scripts/event-labels.json'), 'utf8'));
    expect([...EVENT_LABEL_KEYS]).toEqual(json);
  });
  it('never collides with event_tags control tags', () => {
    for (const k of EVENT_LABEL_KEYS) {
      expect(isInternalTag(k)).toBe(false);
      expect(isGuardedTag(k)).toBe(false);
      expect(INTERNAL_EVENT_TAGS.has(k)).toBe(false);
    }
    for (const t of ['go', 'paid', 'prepay', 'refund', 'nonhub', 'swc', 'avax', 'possible-scam']) {
      expect(EVENT_LABEL_KEYS as readonly string[]).not.toContain(t);
    }
  });
});
