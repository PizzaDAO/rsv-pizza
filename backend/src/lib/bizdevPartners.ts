// soppressata-72251: per-partner BizDev report lenses (TS port of the
// stracciatella-72140 partner config). Each partner FEATURES the taxonomy
// buckets most relevant to it; every other bucket with matches still shows
// under "Other industries". `lensBuckets` order = display order.
//
// Scope for ALL partners is identical: approved GPP events
// (event_type='gpp' AND underboss_status='approved'). The partner only changes
// which buckets are FEATURED, NOT the event universe.
//
// `id` is the public-facing `?partner=` slug. `tag` is the REAL value to compare
// against `SponsorUser.tag` for access control (it usually equals `id`, but
// e.g. Stand With Crypto's sponsor/event tag is `swc`, not `stand-with-crypto`).

export interface BizdevPartner {
  id: string;
  /** Real SponsorUser.tag / event-tag value used for access control. */
  tag: string;
  label: string;
  blurb: string;
  lensBuckets: string[];
}

export const BIZDEV_PARTNERS: BizdevPartner[] = [
  {
    id: 'ens',
    tag: 'ens',
    label: 'ENS',
    blurb: 'Ethereum Name Service — umbrella GPP sponsor. Lens: the Ethereum ecosystem.',
    lensBuckets: ['identity-naming', 'chains-l2-infra', 'wallets-custody', 'defi',
      'developer-tooling', 'daos-communities'],
  },
  {
    id: 'stand-with-crypto',
    // SponsorUser.tag / event-tag is `swc` (confirmed across the codebase:
    // admin.routes.ts opt-in column map, StandWithCryptoCard, PrintTab requireTag).
    tag: 'swc',
    label: 'Stand With Crypto',
    blurb: 'Crypto policy & advocacy. Lens: the whole industry that mobilizes / advocates.',
    lensBuckets: ['advocacy-policy', 'exchanges', 'funds-and-vc', 'stablecoins-payments',
      'chains-l2-infra', 'wallets-custody', 'defi'],
  },
  {
    id: 'brave',
    tag: 'brave',
    label: 'Brave',
    blurb: 'Browser, privacy & BAT. Lens: ad-tech, publishers, privacy, creators.',
    lensBuckets: ['adtech-publishers-privacy', 'wallets-custody', 'media', 'gaming-nft', 'defi'],
  },
  {
    id: 'tangem',
    tag: 'tangem',
    label: 'Tangem',
    blurb: 'Hardware wallet. Lens: self-custody, exchanges, security, Bitcoin.',
    lensBuckets: ['wallets-custody', 'bitcoin-native', 'exchanges', 'security-audit'],
  },
  {
    id: 'bitvavo',
    tag: 'bitvavo',
    label: 'Bitvavo',
    blurb: 'EU exchange. Lens: exchanges, institutional & asset management.',
    lensBuckets: ['exchanges', 'funds-and-vc', 'asset-managers', 'stablecoins-payments'],
  },
  {
    id: 'octant',
    tag: 'octant',
    label: 'Octant',
    blurb: 'Public-goods funding (Golem). Lens: regen, DAOs, grant funds, Ethereum infra.',
    lensBuckets: ['public-goods-regen', 'daos-communities', 'funds-and-vc', 'chains-l2-infra',
      'developer-tooling'],
  },
];

/**
 * Resolve a `?partner=` value (case-insensitive) to a partner config. Matches
 * either the public `id` slug OR the real `tag` so both `stand-with-crypto`
 * and `swc` resolve to the same partner. Returns null for an unknown partner.
 */
export function resolveBizdevPartner(raw: string | null | undefined): BizdevPartner | null {
  if (!raw) return null;
  const q = String(raw).trim().toLowerCase();
  if (!q) return null;
  return (
    BIZDEV_PARTNERS.find((p) => p.id.toLowerCase() === q || p.tag.toLowerCase() === q) || null
  );
}
