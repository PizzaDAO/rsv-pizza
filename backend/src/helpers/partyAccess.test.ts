import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * marinara-71630 P6: the GPP global-editor allowlist moved from a hardcoded
 * const in partyAccess.ts into `app_config` (read via the async
 * `getGppGlobalEditors()` accessor). These tests pin the access-control
 * semantics that MUST be preserved across that swap:
 *   - case-INSENSITIVE email match (both sides lowercased),
 *   - global-editor rights apply ONLY to `eventType === 'gpp'` parties,
 *   - an EMPTY allowlist (the safe fallback) grants no one global rights.
 */

const mockPrisma = vi.hoisted(() => ({
  party: { findUnique: vi.fn() },
  admin: { findUnique: vi.fn() },
  underboss: { findFirst: vi.fn() },
  graphicsAdmin: { findUnique: vi.fn() },
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

// The global-editor allowlist source. Each test sets the resolved list.
const getGppGlobalEditors = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []));
vi.mock('../lib/privateConfig.js', () => ({ getGppGlobalEditors }));

import { canUserEditParty } from './partyAccess.js';

describe('canUserEditParty — GPP global-editor allowlist (app_config-backed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: not an admin / underboss / graphics-admin so the only path that
    // can grant access in these cases is the global-editor allowlist.
    mockPrisma.admin.findUnique.mockResolvedValue(null);
    mockPrisma.underboss.findFirst.mockResolvedValue(null);
    mockPrisma.graphicsAdmin.findUnique.mockResolvedValue(null);
  });

  it('grants edit to a global editor on a GPP event (case-insensitive match)', async () => {
    getGppGlobalEditors.mockResolvedValue(['Editor@Example.com']);
    mockPrisma.party.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'owner-1',
      eventType: 'gpp',
      coHosts: null,
    });

    // Candidate email differs only in casing — must still match.
    const allowed = await canUserEditParty('p1', 'user-2', 'editor@example.com');
    expect(allowed).toBe(true);
  });

  it('does NOT grant global-editor rights on a non-GPP event', async () => {
    getGppGlobalEditors.mockResolvedValue(['editor@example.com']);
    mockPrisma.party.findUnique.mockResolvedValue({
      id: 'p2',
      userId: 'owner-1',
      eventType: 'standard',
      coHosts: null,
    });

    const allowed = await canUserEditParty('p2', 'user-2', 'editor@example.com');
    expect(allowed).toBe(false);
  });

  it('grants no one global rights when the allowlist is EMPTY (safe fallback)', async () => {
    getGppGlobalEditors.mockResolvedValue([]);
    mockPrisma.party.findUnique.mockResolvedValue({
      id: 'p3',
      userId: 'owner-1',
      eventType: 'gpp',
      coHosts: null,
    });

    const allowed = await canUserEditParty('p3', 'user-2', 'editor@example.com');
    expect(allowed).toBe(false);
  });

  it('still lets the party owner edit regardless of the allowlist', async () => {
    getGppGlobalEditors.mockResolvedValue([]);
    mockPrisma.party.findUnique.mockResolvedValue({
      id: 'p4',
      userId: 'owner-1',
      eventType: 'gpp',
      coHosts: null,
    });

    const allowed = await canUserEditParty('p4', 'owner-1', 'owner@example.com');
    expect(allowed).toBe(true);
  });
});
