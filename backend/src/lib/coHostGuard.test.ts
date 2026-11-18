import { describe, it, expect } from 'vitest';
import { coHostListChanged, underbossMayWriteCap } from './coHostGuard.js';

const A = { id: 'a', email: 'a@example.org', canEdit: true, allowedTabs: ['guests'] };
const B = { id: 'b', email: 'b@example.org', canEdit: true };

describe('coHostListChanged', () => {
  it('treats an identical echo (any order, cosmetic fields) as unchanged', () => {
    expect(coHostListChanged([A, B], [{ ...B, name: 'Bee' }, { ...A, avatar: 'x.png' }])).toBe(false);
  });
  it('detects dropped allowedTabs (tab escalation)', () => {
    expect(coHostListChanged([A, B], [{ ...A, allowedTabs: undefined }, B])).toBe(true);
  });
  it('detects added tabs, removed co-hosts, granted canEdit and added entries', () => {
    expect(coHostListChanged([A, B], [{ ...A, allowedTabs: ['guests', 'pizza'] }, B])).toBe(true);
    expect(coHostListChanged([A, B], [A])).toBe(true);
    expect(coHostListChanged([A, { ...B, canEdit: false }], [A, B])).toBe(true);
    expect(coHostListChanged([A], [A, { id: 'c', email: 'c@example.org', canEdit: true }])).toBe(true);
  });
});

describe('underbossMayWriteCap', () => {
  const party = { userId: 'owner', coHosts: [B, { id: 'u', email: 'ub@example.org', isUnderboss: true }] };
  it('requires scope', () => {
    expect(underbossMayWriteCap(party, { userId: 'x', email: 'x@example.org' }, false)).toBe(false);
    expect(underbossMayWriteCap(party, { userId: 'x', email: 'x@example.org' }, true)).toBe(true);
  });
  it('blocks the party owner and ordinary co-hosts', () => {
    expect(underbossMayWriteCap(party, { userId: 'owner', email: 'o@example.org' }, true)).toBe(false);
    expect(underbossMayWriteCap(party, { userId: 'bb', email: 'B@example.org' }, true)).toBe(false);
  });
  it('still allows the system underboss entry for that city', () => {
    expect(underbossMayWriteCap(party, { userId: 'ub', email: 'ub@example.org' }, true)).toBe(true);
  });
});
