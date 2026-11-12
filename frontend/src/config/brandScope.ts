/**
 * White-label scoping (frontend). Everything here is inert unless the build is
 * scoped to an event series (`BRAND.seriesSlug`) or branded (`BRAND.isBranded`),
 * so rsv.pizza (no VITE_BRAND_* set) is unchanged. See
 * plans/whitelabel-team1-monad.md section 4 and decision D8.
 */
import { BRAND } from './brand';

/** True when this build is scoped to a single event series. */
export const IS_SERIES_SCOPED = !!BRAND.seriesSlug;

/**
 * GPP-only and ops routes. On a series-scoped build these redirect to `/`
 * (App.tsx) and their nav entries are hidden.
 */
export const GPP_ONLY_PATHS: readonly string[] = [
  '/gpp',
  '/gpp27',
  '/side',
  '/gpp/pizzerias',
  '/gpp/leaderboard',
  '/leaderboard',
  '/pizza-index',
  '/map',
  '/map/swc',
  '/map/all',
  '/partners',
  '/payments',
  '/payments/hosts',
  '/payments/latam',
  '/payments/southafrica',
  '/payments/africa',
  '/payments/westafrica',
  '/payments/eastafrica',
  '/payments/na',
  '/payments/europe',
  '/payments/india',
  '/payments/asia',
  '/underboss',
  '/underboss/:region',
  '/shipping',
  '/partner',
  '/partner/report',
  '/partner/bizdev',
  '/partner-dashboard',
  '/sponsor-dashboard',
  '/partner-intake/:token',
  '/sponsor-intake/:token',
  '/invoice/:viewToken',
  '/mou/:viewToken',
  '/graphics',
  '/graphics/:slug/edit',
  '/post',
  '/photos',
  '/photos/play',
  '/suggestions',
  '/admin',
  '/admin/series',
  '/admin/logo-cleanup',
  '/raleigh',
  '/cmohhr0640003jp047krjarz0',
  '/tax-form',
];

/**
 * Feature flags for white-label builds (decision D8): donations (PizzaDAO
 * Stripe) and NFT minting are hidden on branded builds; AI ordering stays on.
 */
export const BRAND_FEATURES = {
  donations: !BRAND.isBranded,
  nftMinting: !BRAND.isBranded,
} as const;
