/**
 * tortelli-92103: India regional payments portal.
 *
 * Thin wrapper around `PaymentsAdminPage` that fixes the region scope to
 * India so @simarpreet_019 can review every Indian payout, approve/reject/
 * revert, edit per-event caps, leave admin notes, and click "Flag ready for
 * payment".
 *
 * Funds-sending operations stay admin-only — the underboss sees the Hot
 * Wallet card in read-only mode.
 */
import React from 'react';
import { PAYMENTS_REGION_SCOPES } from '../utils/regions';
import { PaymentsAdminPage } from './PaymentsAdminPage';

export function IndiaPaymentsPage() {
  return (
    <PaymentsAdminPage
      regionFilter={Array.from(PAYMENTS_REGION_SCOPES.india)}
      portalSlug="india"
    />
  );
}
