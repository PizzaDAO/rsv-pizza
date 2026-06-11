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
import { prisma } from '../config/database.js';

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

/**
 * Re-stamp a host's UPDATED payout prefs onto their non-terminal rolling event
 * payouts. Extracted verbatim from the PATCH /api/user/me handler
 * (user.routes.ts) so the Telegram wallet-via-DM path (telegram-inbound.routes)
 * re-stamps IDENTICALLY — same scope (hostUserId + purpose:'event' + the three
 * NON_TERMINAL_PAYOUT_STATUSES + the mercury_card guard) and same snapshot.
 *
 * The execute/send path reads the payout ROW (no host fallback), so without
 * this a host who fixes their wallet AFTER a rolling row already exists (incl.
 * after an admin approved it) stays un-payable (ricotta-58512 / tortano-58516).
 *
 * Best-effort: never throws — the profile save itself is the source of truth;
 * a failed row sync is logged and swallowed exactly as the website does.
 */
export async function restampHostNonTerminalPayouts(user: {
  id: string;
  preferredPayoutMethod: string | null;
  payoutWalletAddress: string | null;
  payoutBankDetails: Prisma.JsonValue | null;
}): Promise<void> {
  try {
    const snap = payoutRowSnapshotFromUser(user);
    await prisma.payout.updateMany({
      where: {
        hostUserId: user.id,
        purpose: 'event',
        status: { in: [...NON_TERMINAL_PAYOUT_STATUSES] },
        NOT: { payoutMethod: 'mercury_card' },
      },
      data: snap,
    });
  } catch (err) {
    console.warn('[payout-snapshot] failed to sync payout prefs onto rolling rows:', err);
  }
}

/**
 * Save a host's payout WALLET (only) and re-stamp their non-terminal rolling
 * rows — the reusable core shared by the website (PATCH /api/user/me) and the
 * Telegram wallet-via-DM path. `resolvedWallet` MUST already be a canonical 0x
 * address (ENS resolved at the call boundary via resolveWalletInput, mirroring
 * the website — do NOT re-resolve here). Returns the updated user prefs.
 */
export async function saveHostPayoutWallet(
  userId: string,
  resolvedWallet: string,
): Promise<{
  id: string;
  preferredPayoutMethod: string | null;
  payoutWalletAddress: string | null;
  payoutBankDetails: Prisma.JsonValue | null;
}> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { payoutWalletAddress: resolvedWallet },
    select: {
      id: true,
      preferredPayoutMethod: true,
      payoutWalletAddress: true,
      payoutBankDetails: true,
    },
  });
  await restampHostNonTerminalPayouts(user);
  return user;
}
