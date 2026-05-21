import type { AdminPayout } from '../types';

/**
 * siciliana-69183: Build a Gnosis Safe Transaction Builder v1.0 batch JSON
 * from a list of selected payouts on the admin /payments dashboard. The
 * admin downloads the resulting file and drag-and-drops it into the Safe
 * Transaction Builder app to execute the batch from the PizzaDAO Safe.
 *
 * Filter rules (must match the airdrop-CSV filter used elsewhere):
 *   - payoutMethod === 'usdc_base'   (Mercury / wire can't be batched on Safe)
 *   - payoutWalletAddress matches /^0x[0-9a-fA-F]{40}$/
 *     (ENS strings should already be resolved per taleggio-30219 — anything
 *      that doesn't match is malformed and is silently skipped, counted in
 *      the modal's "skipped" tally)
 *   - finalAmountUsd > 0
 *
 * Amount conversion: USDC on Base has 6 decimals. We multiply by 1e6 and
 * round to the nearest integer, then `.toString()` the BigInt for the JSON
 * "amount" field (Safe expects a decimal string).
 *
 * The `label` argument only affects the `meta.name` / `meta.description`
 * and the downloaded filename — it does NOT re-derive amounts. The prepay
 * queue already persists 50% of the cap as `finalAmountUsd`, so the math
 * is already done by the time payouts reach this batcher.
 */

/** USDC contract on Base mainnet. */
export const USDC_BASE_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** Base mainnet chainId, as a stringified number (Safe expects a string). */
export const BASE_CHAIN_ID = '8453';

/** Tx-builder schema version we target. */
const SAFE_TX_BUILDER_VERSION = '1.16.5';

export type SafeBatchLabel = 'prepayment_50' | 'final' | 'custom';

export interface SafeBatchResult {
  /** Pretty-printed JSON ready to drop into a Blob. */
  json: string;
  /** Count of payouts that made it into the batch. */
  included: number;
  /** Count of payouts that were filtered out (non-USDC / bad wallet / $0). */
  skipped: number;
  /** Suggested download filename, e.g. `safe-batch-prepayment-50-2026-05-20.json`. */
  filename: string;
}

function humanLabel(label: SafeBatchLabel): string {
  switch (label) {
    case 'prepayment_50':
      return '50% Prepayment';
    case 'final':
      return 'Final Payment';
    case 'custom':
    default:
      return 'Custom batch';
  }
}

/**
 * Build the batch + filename + count summary. Pure — no DOM / fetch side
 * effects. Caller is responsible for triggering the download.
 */
export function buildSafeBatch(
  payouts: AdminPayout[],
  label: SafeBatchLabel,
): SafeBatchResult {
  const walletRe = /^0x[0-9a-fA-F]{40}$/;

  const valid = payouts.filter((p) => {
    if (p.payoutMethod !== 'usdc_base') return false;
    if (typeof p.payoutWalletAddress !== 'string') return false;
    const addr = p.payoutWalletAddress.trim();
    if (!walletRe.test(addr)) return false;
    const amt = Number(p.finalAmountUsd);
    if (!Number.isFinite(amt) || amt <= 0) return false;
    return true;
  });

  const labelHuman = humanLabel(label);
  const date = new Date().toISOString().slice(0, 10);

  const batch = {
    version: '1.0',
    chainId: BASE_CHAIN_ID,
    createdAt: Date.now(),
    meta: {
      name: `PizzaDAO ${labelHuman}`,
      description:
        `${valid.length} USDC-on-Base transfers from PizzaDAO Safe — generated ${date}`,
      txBuilderVersion: SAFE_TX_BUILDER_VERSION,
      createdFromSafeAddress: '',
      createdFromOwnerAddress: '',
      checksum: '',
    },
    transactions: valid.map((p) => ({
      to: USDC_BASE_ADDRESS,
      value: '0',
      data: null as null,
      contractMethod: {
        inputs: [
          { internalType: 'address', name: 'to', type: 'address' },
          { internalType: 'uint256', name: 'amount', type: 'uint256' },
        ],
        name: 'transfer',
        payable: false,
      },
      contractInputsValues: {
        to: (p.payoutWalletAddress as string).trim(),
        amount: BigInt(Math.round(Number(p.finalAmountUsd) * 1_000_000)).toString(),
      },
    })),
  };

  const filename = `safe-batch-${label}-${date}.json`;

  return {
    json: JSON.stringify(batch, null, 2),
    included: valid.length,
    skipped: payouts.length - valid.length,
    filename,
  };
}

/**
 * Trigger a browser download for the given Safe-batch result. Creates a Blob,
 * binds it to a temporary <a download>, clicks it, and revokes the object
 * URL. No-op when running in a non-DOM environment (e.g. unit tests via jsdom
 * fallback).
 */
export function downloadSafeBatch(result: SafeBatchResult): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([result.json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
