/**
 * tortelli-92103: North America regional payments portal.
 *
 * Thin wrapper around `PaymentsAdminPage` that fixes the region scope to
 * USA + Canada so @cauleneamagi can review every North American payout,
 * approve/reject/revert, edit per-event caps, leave admin notes, and click
 * "Flag ready for payment".
 *
 * Funds-sending operations stay admin-only — the underboss sees the Hot
 * Wallet card in read-only mode.
 */
import React from 'react';
import { PAYMENTS_REGION_SCOPES } from '../utils/regions';
import { PaymentsAdminPage } from './PaymentsAdminPage';

export function NaPaymentsPage() {
  return (
    <PaymentsAdminPage
      regionFilter={Array.from(PAYMENTS_REGION_SCOPES.na)}
      portalSlug="na"
    />
  );
}
