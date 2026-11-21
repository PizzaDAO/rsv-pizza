/**
 * Pure helpers for the name-tag route: guests -> identifiers (hashes + wallets), and matches -> one member
 * per guest. No emails or wallets are ever part of the output.
 */
import { emailSha256 } from './pizzadaoLink.js';
import type { NametagMatch, NametagMember } from '../services/pizzadaoNametags.js';

export interface TagGuest {
  id: string;
  email: string | null;
  ethereumAddress: string | null;
  submittedAt: Date;
  approved: boolean | null;
}

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

export const hashEmail = emailSha256;

/** Declined guests never get a tag. */
export const eligible = (g: Pick<TagGuest, 'approved'>): boolean => g.approved !== false;

export function collectIdentifiers(guests: TagGuest[]): { emailHashes: string[]; wallets: string[] } {
  const hashes = new Set<string>();
  const wallets = new Set<string>();
  for (const g of guests) {
    if (!eligible(g)) continue;
    if (g.email?.includes('@')) hashes.add(hashEmail(g.email));
    if (g.ethereumAddress && EVM_RE.test(g.ethereumAddress.trim())) wallets.add(g.ethereumAddress.trim().toLowerCase());
  }
  return { emailHashes: [...hashes], wallets: [...wallets] };
}

/**
 * guest id -> member. An email match wins over a wallet match. A member who RSVP'd more than once
 * (two guest rows) is attached to the earliest RSVP only, so they get one member tag.
 */
export function assignMembers(guests: TagGuest[], matches: NametagMatch[]): Record<string, NametagMember> {
  const byHash = new Map<string, NametagMember>();
  const byWallet = new Map<string, NametagMember>();
  for (const m of matches) {
    if (m.emailHash && !byHash.has(m.emailHash)) byHash.set(m.emailHash, m.member);
    if (m.wallet && !byWallet.has(m.wallet)) byWallet.set(m.wallet, m.member);
  }
  const ordered = guests.filter(eligible).sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  const taken = new Set<string>();
  const out: Record<string, NametagMember> = {};
  for (const g of ordered) {
    const member =
      (g.email?.includes('@') ? byHash.get(hashEmail(g.email)) : undefined) ??
      (g.ethereumAddress ? byWallet.get(g.ethereumAddress.trim().toLowerCase()) : undefined);
    if (!member || taken.has(member.memberId)) continue;
    taken.add(member.memberId);
    out[g.id] = member;
  }
  return out;
}
