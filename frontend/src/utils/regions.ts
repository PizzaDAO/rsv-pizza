/**
 * argentina-92103: Regional /payments portals.
 *
 * Each portal-slug maps to a fixed list of `parties.region` values the
 * payments-admin queue should be filtered down to. The LATAM portal
 * (`/payments/latam`) covers Central + South America so the LATAM
 * underboss (`donmalbec.eth@gmail.com`) can review and approve every
 * payout in his region without exposing the rest of the world.
 */

export const LATAM_REGIONS = ['central-america', 'south-america'] as const;

export type PaymentsRegionPortal = 'latam';

export const PAYMENTS_REGION_LABELS: Record<PaymentsRegionPortal, string> = {
  latam: 'LATAM',
};

export const PAYMENTS_REGION_SCOPES: Record<PaymentsRegionPortal, readonly string[]> = {
  latam: LATAM_REGIONS,
};
