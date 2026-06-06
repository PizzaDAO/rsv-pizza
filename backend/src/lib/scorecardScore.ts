/**
 * panzerotti-58931: shared scorecard scoring constants.
 *
 * Single source of truth for the unified leaderboard. Imported by both
 * `publicLeaderboard.routes.ts` (the unified public board) and
 * `scorecard.routes.ts` (the per-party "This Party" board) so the two boards
 * agree on what scorecard activity is worth.
 *
 * marinara-71630: the per-win "Best Of" bonus is a private scoring constant —
 * it is sourced from `app_config` (private.scoring_weights → leaderboard.bestOfBonus)
 * via `getBestOfBonus()` rather than hardcoded here. Call the async accessor at
 * each handler's entry and use the returned number. The de-duped item-key list
 * below is NOT a private business value (it's a set of public activity keys), so
 * it stays in source.
 */

import { getScoringWeights } from './privateConfig.js';

// Single tunable bonus per Best Of win, resolved from `app_config`
// (private.scoring_weights → leaderboard.bestOfBonus). Imported by
// publicLeaderboard.routes.ts and scorecard.routes.ts so the per-party board
// and the global board agree.
//
// The real value is seeded to prod; committed source carries a NON-SENSITIVE
// placeholder (1 = a Best Of win is worth one item, never NaN/zero-collapse)
// so the math stays well-defined if the config row is briefly absent.
export const BEST_OF_BONUS_PLACEHOLDER = 1;

/**
 * Resolve the Best Of bonus from the seeded leaderboard scoring weights.
 * Call this at each handler's async entry, then use the returned number.
 */
export async function getBestOfBonus(): Promise<number> {
  const raw = (await getScoringWeights()).leaderboard.bestOfBonus;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : BEST_OF_BONUS_PLACEHOLDER;
}

/**
 * De-duped scorecard item set for the leaderboard.
 *
 * Deliberately EXCLUDES the generic `photo` and `pizza_selfie` item keys: those
 * overlap engagement's approved-photo count (`0.5 * photos`), so counting them
 * here would double-count the same activity. The Photo Game challenges
 * (`photo_box_stack`, `photo_host`, `photo_partner`) upload to storage only and
 * never create a `photos` row, so they do NOT overlap engagement and are
 * included.
 */
export const SCORECARD_LEADERBOARD_ITEMS = [
  'post',
  'vouch',
  'sign_pizza_box',
  'join_telegram',
  'follow_pizzadao',
  'signup_pizzadao',
  'photo_box_stack',
  'photo_host',
  'photo_partner',
] as const;
