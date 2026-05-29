/**
 * Regional /payments portals.
 *
 * Each portal-slug maps to a fixed list of `parties.region` values the
 * payments-admin queue should be filtered down to. Built so a regional
 * underboss can review and approve every payout in their region without
 * exposing the rest of the world.
 *
 * argentina-92103 shipped the LATAM portal. tortelli-92103 extends the
 * mapping to cover every other UB region defined by Snax's regional split:
 *   /payments/latam        → @donmalbec.eth (Central + South America)
 *   /payments/southafrica  → @pnsibanda (South Africa country)
 *   /payments/africa       → @BuildwithMc + @PeriPeriPacino (West / East /
 *                            South Africa region slugs)
 *   /payments/na           → @cauleneamagi (USA + Canada)
 *   /payments/europe       → @APlazzi (Western + Eastern Europe)
 *   /payments/india        → @simarpreet_019 (India)
 *   /payments/asia         → @lianna_adams (China + Middle East + Asia +
 *                            Oceania — every non-India Asia/Pacific slug)
 *
 * South Africa caveat: @pnsibanda has the SA country in scope, but the
 * broader Africa UBs also have `south-africa` in their `underbosses.regions`
 * array, so both `/payments/southafrica` and `/payments/africa` show SA
 * events. v1 ships this overlap intentionally — Snax can refine if needed.
 *
 * Region slugs match the canonical `GPP_REGIONS` enum in `frontend/src/types.ts`.
 */

export const LATAM_REGIONS = ['central-america', 'south-america'] as const;
export const SOUTHAFRICA_REGIONS = ['south-africa'] as const;
export const AFRICA_REGIONS = ['west-africa', 'east-africa', 'south-africa'] as const;
export const NA_REGIONS = ['usa', 'canada'] as const;
export const EUROPE_REGIONS = ['western-europe', 'eastern-europe'] as const;
export const INDIA_REGIONS = ['india'] as const;
export const ASIA_REGIONS = ['china', 'middle-east', 'asia', 'oceania'] as const;

export type PaymentsRegionPortal =
  | 'latam'
  | 'southafrica'
  | 'africa'
  | 'na'
  | 'europe'
  | 'india'
  | 'asia';

export const PAYMENTS_REGION_LABELS: Record<PaymentsRegionPortal, string> = {
  latam: 'LATAM',
  southafrica: 'South Africa',
  africa: 'Africa',
  na: 'North America',
  europe: 'Europe',
  india: 'India',
  asia: 'Asia & Oceania',
};

export const PAYMENTS_REGION_SCOPES: Record<PaymentsRegionPortal, readonly string[]> = {
  latam: LATAM_REGIONS,
  southafrica: SOUTHAFRICA_REGIONS,
  africa: AFRICA_REGIONS,
  na: NA_REGIONS,
  europe: EUROPE_REGIONS,
  india: INDIA_REGIONS,
  asia: ASIA_REGIONS,
};

/**
 * pancetta-92103: display order for the /payments admin Regions multi-select.
 * Roughly west-to-east, with the two Africa portals adjacent so the SA-overlap
 * (see header comment) is visible at a glance.
 */
export const PAYMENTS_REGION_DISPLAY_ORDER: PaymentsRegionPortal[] = [
  'latam',
  'na',
  'europe',
  'africa',
  'southafrica',
  'india',
  'asia',
];
