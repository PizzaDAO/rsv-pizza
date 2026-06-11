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
import { resolveWalletInput } from './ens.service.js';

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
 * suppli-58533 / tortano-58516: re-stamp the host's CURRENT profile payout
 * prefs onto their non-terminal rolling `event` payout rows.
 *
 * EXTRACTED verbatim from the PATCH /api/user/me handler (user.routes.ts) so the
 * wallet-via-DM path (telegram-inbound.routes.ts) writes the row snapshot via
 * the identical code — the execute/send path reads the payout ROW with no host
 * fallback, so a wallet saved only on the User profile leaves the host
 * un-payable (ricotta-58512 incident). The mercury_card guard avoids clobbering
 * an admin-issued Mercury card with the host's self-serve prefs. Best-effort:
 * never throws — the caller's profile save already succeeded.
 */
export async function restampHostRollingPayoutRows(
  userId: string,
  // Optional already-loaded profile snapshot. user.routes.ts passes the user it
  // just updated (no extra query); the DM path omits it so we re-read here.
  preloaded?: {
    preferredPayoutMethod: string | null;
    payoutWalletAddress: string | null;
    payoutBankDetails: Prisma.JsonValue | null;
  },
): Promise<void> {
  try {
    const user =
      preloaded ??
      (await prisma.user.findUnique({
        where: { id: userId },
        select: {
          preferredPayoutMethod: true,
          payoutWalletAddress: true,
          payoutBankDetails: true,
        },
      }));
    if (!user) return;
    const snap = payoutRowSnapshotFromUser(user);
    await prisma.payout.updateMany({
      where: {
        hostUserId: userId,
        purpose: 'event',
        status: { in: [...NON_TERMINAL_PAYOUT_STATUSES] },
        NOT: { payoutMethod: 'mercury_card' },
      },
      data: snap,
    });
  } catch (err) {
    console.warn('[payout-snapshot] failed to re-stamp rolling payout rows:', err);
  }
}

/**
 * suppli-58533: save a host's payout wallet exactly like the website does
 * (PATCH /api/user/me wallet path) and re-stamp their rolling payout rows.
 *
 *   1. Resolve the input via the SAME `resolveWalletInput` (accepts a 0x… EVM
 *      address OR an ENS name; throws on anything else — caller surfaces a
 *      friendly message).
 *   2. Persist the resolved 0x onto `User.payoutWalletAddress`.
 *   3. Re-stamp non-terminal rolling rows (the un-payable-without-this step).
 *
 * Returns the resolved 0x address. Throws (with the resolver's message) on an
 * unresolvable input so the DM handler can reply a helpful rejection.
 */
export async function saveHostPayoutWalletAndRestamp(
  userId: string,
  walletInput: string,
): Promise<string> {
  // (1) Resolve — identical boundary to user.routes.ts (ENS → 0x or 0x verbatim).
  const resolved = await resolveWalletInput(String(walletInput));

  // (2) Persist onto the host profile (the website's source of truth).
  await prisma.user.update({
    where: { id: userId },
    data: { payoutWalletAddress: resolved },
  });

  // (3) Re-stamp the rolling rows so the wallet is actually payable.
  await restampHostRollingPayoutRows(userId);

  return resolved;
}
