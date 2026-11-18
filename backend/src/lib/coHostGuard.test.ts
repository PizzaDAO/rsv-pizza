import { describe, it, expect } from 'vitest';
import { coHostEscalation, underbossMayWriteCap } from './coHostGuard.js';

const A = { id: 'a', email: 'a@example.org', canEdit: true, allowedTabs: ['guests'] };
const B = { id: 'b', email: 'b@example.org', canEdit: true };

describe('coHostEscalation', () => {
  const PARTNER = { id: 'p', email: 'p@example.org', isPartner: true };
  it('allows cosmetic edits, reorder and an unchanged echo', () => {
    expect(coHostEscalation([A, B], [{ ...B, name: 'Bee' }, { ...A, avatar: 'x.png' }])).toBe(false);
  });
  it('allows adding/removing non-editor partner entries', () => {
    expect(coHostEscalation([A, PARTNER], [A])).toBe(false);
    expect(coHostEscalation([A], [A, { id: 'n', email: 'n@example.org', name: 'N' }])).toBe(false);
  });
  it('detects dropped or widened allowedTabs and canEdit changes', () => {
    expect(coHostEscalation([A, B], [{ ...A, allowedTabs: undefined }, B])).toBe(true);
    expect(coHostEscalation([A, B], [{ ...A, allowedTabs: ['guests', 'pizza'] }, B])).toBe(true);
    expect(coHostEscalation([A, { ...B, canEdit: false }], [A, B])).toBe(true);
  });
  it('detects removing an editor, adding an editor, and swapping an editor email', () => {
    expect(coHostEscalation([A, B], [A])).toBe(true);
    expect(coHostEscalation([A], [A, { id: 'c', email: 'c@example.org', canEdit: true }])).toBe(true);
    expect(coHostEscalation([A], [{ id: 'z', email: 'c@example.org', allowedTabs: ['guests'] }])).toBe(true);
    expect(coHostEscalation([A, B], [A, { ...B, email: 'evil@example.org' }])).toBe(true);
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
