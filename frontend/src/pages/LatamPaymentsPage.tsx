/**
 * argentina-92103: LATAM regional payments portal.
 *
 * Thin wrapper around `PaymentsAdminPage` that fixes the region scope to
 * Central + South America so the LATAM underboss (`donmalbec.eth@gmail.com`)
 * can review every LATAM payout, approve/reject/revert, edit per-event caps,
 * leave admin notes, and click "Flag ready for payment" — which records an
 * audit row + notifies the payments team via Telegram + email.
 *
 * Funds-sending operations (USDC execute, Mercury / wire mark-paid, Bulk
 * Send, Export Safe JSON, Record External Payment, Hot Wallet refresh)
 * stay admin-only — the underboss sees the Hot Wallet card in read-only mode.
 */
import React from 'react';
import { LATAM_REGIONS } from '../utils/regions';
import { PaymentsAdminPage } from './PaymentsAdminPage';

export function LatamPaymentsPage() {
  return (
    <PaymentsAdminPage
      regionFilter={Array.from(LATAM_REGIONS)}
      portalSlug="latam"
    />
  );
}
