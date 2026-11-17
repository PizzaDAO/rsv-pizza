import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { INTERNAL_EVENT_TAGS, INTERNAL_TAG_PATTERNS } from './eventTags';

// blackolive-70521: keep in lockstep with backend/src/lib/eventTags.ts via the
// shared fixture (the backend test asserts the same file).
const fixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../scripts/internal-event-tags.json'), 'utf8'),
);

describe('eventTags parity with scripts/internal-event-tags.json', () => {
  it('INTERNAL_EVENT_TAGS matches the fixture', () => {
    expect([...INTERNAL_EVENT_TAGS].sort()).toEqual(fixture.tags);
  });
  it('INTERNAL_TAG_PATTERNS matches the fixture', () => {
    expect(INTERNAL_TAG_PATTERNS.map((r) => ({ source: r.source, flags: r.flags }))).toEqual(
      fixture.patterns,
    );
  });
});
