/**
 * panzerotti-58931: shared scorecard scoring constants.
 *
 * Single source of truth for the unified leaderboard. Imported by both
 * `publicLeaderboard.routes.ts` (the unified public board) and
 * `scorecard.routes.ts` (the per-party "This Party" board) so the two boards
 * agree on what scorecard activity is worth.
 */

/** Points per "Best Of" superlative win (a `superlative_submissions` row with
 *  status='winner'). */
export const BEST_OF_BONUS = 5;

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
