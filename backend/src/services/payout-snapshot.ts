/**
 * ricotta-58512: shared payout-row snapshot helpers.
 *
 * The rolling-reimbursement flow (ziti-58300) never copied the host's payout
 * method/wallet onto the `payouts` row — that data lives only on the host
 * `User` profile (preferredPayoutMethod / payoutWalletAddress /
 * payoutBankDetails, set via PATCH /api/user/me). The execute/send path reads
 * the payout ROW with NO host fallback, so hosts who entered their wallet
 * correctly were un-payable. These helpers re-introduce the snapshot the old
 * POST /payouts create used to do, at the rolling write points.
 *
 * Kept in its own module (imported by both payout.routes.ts and user.routes.ts)
 * to avoid a require cycle between those two route files.
 */
import { Prisma } from '@prisma/client';

// Non-terminal statuses: a rolling record is "active" while in one of these.
// Terminal = paid | completed | withdrawn | rejected | failed.
export const NON_TERMINAL_PAYOUT_STATUSES = ['pending', 'approved', 'queued'] as const;

/**
 * method-consistent snapshot of a host's payout prefs, shaped for a payouts-row
 * write. Mirrors the old POST /payouts rule: wallet only for usdc_base, bank
 * only for wire. The non-matching method field is nulled so switching method
 * leaves no stale field behind. Wallet is copied verbatim (it is already
 * ENS-resolved to 0x at the User PATCH boundary — do NOT re-resolve here).
 */
export function payoutRowSnapshotFromUser(u: {
  preferredPayoutMethod: string | null;
  payoutWalletAddress: string | null;
  payoutBankDetails: Prisma.JsonValue | null;
}) {
  const method = u.preferredPayoutMethod ?? null;
  return {
    payoutMethod: method,
    payoutWalletAddress: method === 'usdc_base' ? (u.payoutWalletAddress ?? null) : null,
    payoutBankDetails:
      method === 'wire' && u.payoutBankDetails != null
        ? (u.payoutBankDetails as Prisma.InputJsonValue)
        : Prisma.JsonNull,
  };
}
