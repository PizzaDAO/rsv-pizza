/**
 * Pure helpers for the name-tag route: guests -> identifiers (hashes + wallets), and matches -> one member
 * per guest. No emails or wallets are ever part of the output.
 */
import { emailSha256 } from './pizzadaoLink.js';
import type { NametagMatch, NametagMember } from '../services/pizzadaoNametags.js';

export interface TagGuest {
  id: string;
  email: string | null;
  submittedVia: string;
  status: string;
  approved: boolean | null;
  emailVerifiedAt: Date | null;
}

export const hashEmail = emailSha256;

/**
 * Only guests who RSVP'd themselves (link), are confirmed and not declined, and PROVED their email (the RSVP was
 * made signed in as that address) are looked up. Host-added, imported, invited, waitlisted and unproven rows
 * never leave this app, so a host cannot use the lookup to probe arbitrary addresses. Wallets are never sent:
 * a typed-in wallet is unproven.
 */
export const eligible = (g: TagGuest): boolean =>
  g.submittedVia === 'link' && g.status === 'CONFIRMED' && g.approved !== false && !!g.emailVerifiedAt && !!g.email?.includes('@');

export function collectIdentifiers(guests: TagGuest[]): { emailHashes: string[]; wallets: string[] } {
  const hashes = new Set<string>();
  for (const g of guests) if (eligible(g)) hashes.add(hashEmail(g.email as string));
  return { emailHashes: [...hashes], wallets: [] };
}

/** guest id -> member (email hash match). Several guests may map to the same member; the client prints one tag per member. */
export function assignMembers(guests: TagGuest[], matches: NametagMatch[]): Record<string, NametagMember> {
  const byHash = new Map<string, NametagMember>();
  for (const m of matches) if (m.emailHash && !byHash.has(m.emailHash)) byHash.set(m.emailHash, m.member);
  const out: Record<string, NametagMember> = {};
  for (const g of guests) {
    if (!eligible(g)) continue;
    const member = byHash.get(hashEmail(g.email as string));
    if (member) out[g.id] = member;
  }
  return out;
}
