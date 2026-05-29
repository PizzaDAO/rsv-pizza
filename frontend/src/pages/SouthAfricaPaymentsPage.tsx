/**
 * tortelli-92103: South Africa regional payments portal.
 *
 * Thin wrapper around `PaymentsAdminPage` that fixes the region scope to
 * the South Africa country slug so @pnsibanda can review every SA payout,
 * approve/reject/revert, edit per-event caps, leave admin notes, and click
 * "Flag ready for payment".
 *
 * Funds-sending operations (USDC execute, Mercury / wire mark-paid, Bulk
 * Send, Export Safe JSON, Record External Payment, Hot Wallet refresh)
 * stay admin-only — the underboss sees the Hot Wallet card in read-only mode.
 *
 * Caveat: the broader Africa portal (`/payments/africa`) also includes the
 * `south-africa` slug, so SA events surface in both portals. v1 ships this
 * overlap intentionally.
 */
import React from 'react';
import { PAYMENTS_REGION_SCOPES } from '../utils/regions';
import { PaymentsAdminPage } from './PaymentsAdminPage';

export function SouthAfricaPaymentsPage() {
  return (
    <PaymentsAdminPage
      regionFilter={Array.from(PAYMENTS_REGION_SCOPES.southafrica)}
      portalSlug="southafrica"
    />
  );
}
