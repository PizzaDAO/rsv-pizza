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
  submittedVia: string;
  status: string;
  approved: boolean | null;
}

export const hashEmail = emailSha256;

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Only guests who RSVP'd themselves (link), are confirmed and not declined are looked up. Host-added, imported,
 * invited, checked-in-at-the-door and waitlisted rows never leave this app, so a host cannot use the lookup to
 * probe arbitrary addresses. rsv.pizza does not prove the email or wallet on an RSVP; pizzadao.org does the proving
 * (it matches only a member's verified email, linked rsv.pizza account or linked wallet).
 */
export const eligible = (g: TagGuest): boolean => g.submittedVia === 'link' && g.status === 'CONFIRMED' && g.approved !== false;

const validEmail = (e: string | null): e is string => !!e && e.includes('@');
const validWallet = (w: string | null): w is string => !!w && EVM_RE.test(w.trim());

export function collectIdentifiers(guests: TagGuest[]): { emailHashes: string[]; wallets: string[] } {
  const hashes = new Set<string>();
  const wallets = new Set<string>();
  for (const g of guests) {
    if (!eligible(g)) continue;
    if (validEmail(g.email)) hashes.add(hashEmail(g.email));
    if (validWallet(g.ethereumAddress)) wallets.add(g.ethereumAddress.trim().toLowerCase());
  }
  return { emailHashes: [...hashes], wallets: [...wallets] };
}

/**
 * guest id -> member. An email match wins over a wallet match. Several guests may map to the same member;
 * the client prints one tag per member.
 */
export function assignMembers(guests: TagGuest[], matches: NametagMatch[]): Record<string, NametagMember> {
  const byHash = new Map<string, NametagMember>();
  const byWallet = new Map<string, NametagMember>();
  for (const m of matches) {
    if (m.emailHash && !byHash.has(m.emailHash)) byHash.set(m.emailHash, m.member);
    if (m.wallet && !byWallet.has(m.wallet)) byWallet.set(m.wallet, m.member);
  }
  const out: Record<string, NametagMember> = {};
  for (const g of guests) {
    if (!eligible(g)) continue;
    const member =
      (validEmail(g.email) ? byHash.get(hashEmail(g.email)) : undefined) ??
      (validWallet(g.ethereumAddress) ? byWallet.get(g.ethereumAddress.trim().toLowerCase()) : undefined);
    if (member) out[g.id] = member;
  }
  return out;
}
