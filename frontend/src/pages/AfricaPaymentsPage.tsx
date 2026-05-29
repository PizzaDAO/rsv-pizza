/**
 * tortelli-92103: Africa regional payments portal.
 *
 * Thin wrapper around `PaymentsAdminPage` that fixes the region scope to
 * West / East / South Africa so the Africa underbosses (@BuildwithMc and
 * @PeriPeriPacino) can review every African payout, approve/reject/revert,
 * edit per-event caps, leave admin notes, and click "Flag ready for payment".
 *
 * Funds-sending operations stay admin-only — underbosses see the Hot Wallet
 * card in read-only mode.
 */
import React from 'react';
import { PAYMENTS_REGION_SCOPES } from '../utils/regions';
import { PaymentsAdminPage } from './PaymentsAdminPage';

export function AfricaPaymentsPage() {
  return (
    <PaymentsAdminPage
      regionFilter={Array.from(PAYMENTS_REGION_SCOPES.africa)}
      portalSlug="africa"
    />
  );
}
