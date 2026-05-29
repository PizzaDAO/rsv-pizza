/**
 * tortelli-92103: Asia & Oceania regional payments portal.
 *
 * Thin wrapper around `PaymentsAdminPage` that fixes the region scope to
 * China + Middle East + Asia + Oceania so @lianna_adams can review every
 * Asian/Pacific (non-India) payout, approve/reject/revert, edit per-event
 * caps, leave admin notes, and click "Flag ready for payment".
 *
 * Funds-sending operations stay admin-only — the underboss sees the Hot
 * Wallet card in read-only mode.
 */
import React from 'react';
import { PAYMENTS_REGION_SCOPES } from '../utils/regions';
import { PaymentsAdminPage } from './PaymentsAdminPage';

export function AsiaPaymentsPage() {
  return (
    <PaymentsAdminPage
      regionFilter={Array.from(PAYMENTS_REGION_SCOPES.asia)}
      portalSlug="asia"
    />
  );
}
