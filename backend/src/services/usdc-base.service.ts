/**
 * USDC-on-Base payment service (arugula-38633, PR 5).
 *
 * Sends USDC from a self-custodied hot wallet to a recipient on Base mainnet.
 * The wallet private key lives in `USDC_PAYOUT_WALLET_PRIVATE_KEY` (Vercel env)
 * and is loaded into a viem account on demand — never logged.
 *
 * Pre-flight safety (defense in depth — every check runs every time):
 *   1. recipient `toAddress` must be a valid 0x address (viem `isAddress`)
 *   2. `amountUsd` > 0 and ≤ USDC_PAYOUT_MAX_USD env (default 200)
 *   3. HARD ceiling `amountUsd` ≤ $1000 regardless of env (cannot be overridden)
 *   4. wallet USDC balance ≥ `amountUsd` (read from Base via public RPC)
 *   5. running 24h sum of paid USDC payouts + `amountUsd` ≤ USDC_PAYOUT_DAILY_CAP_USD
 *      (default $2000) — queried from the `payouts` table
 *
 * On submit we wait for the tx receipt and confirm `status === 'success'` before
 * returning. Caller is responsible for updating the payout row to status=paid
 * with the returned `txHash`.
 *
 * Logs addresses + amounts + tx hashes for auditability; NEVER logs the
 * private key.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseUnits,
  isAddress,
  type Hex,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { prisma } from '../config/database.js';
import { looksLikeEnsName, resolveEns } from './ens.service.js';

const USDC_BASE_ADDRESS: Hex = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;
const HARD_PER_TX_CEILING_USD = 675;
const DEFAULT_PER_TX_CAP_USD = 200;
const DEFAULT_DAILY_CAP_USD = 2000;
const TX_RECEIPT_TIMEOUT_MS = 90_000;

/**
 * bianco-89172: per-address cumulative cap. No single 0x address should ever
 * receive more than $676 USDC (cassoeula-92103, was $651) across all parties
 * without explicit admin acknowledgement. Matches HARD_PER_TX_CEILING_USD +
 * $1 cushion (so a single at-the-ceiling tx doesn't accidentally trip this)
 * while still catching the double-payment scenarios observed in Osogbo ($626)
 * and Seropédica ($600).
 * Override via `sendUsdcPayment(addr, amt, { allowOverPerAddressCap: true })`.
 */
export const PER_ADDRESS_HARD_CAP_USD = 676;

const ERC20_TRANSFER_ABI = [
  {
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export interface SendUsdcResult {
  txHash: `0x${string}`;
  fromAddress: `0x${string}`;
  toAddress: `0x${string}`;
  amountUsd: number;
  /**
   * caciotta-92104: when the caller passed an ENS name, this is the
   * resolved 0x address used on-chain (same as `toAddress`); when the
   * caller passed a 0x address, this is null. Used by the execute path
   * to persist the canonical 0x back onto the Payout row so subsequent
   * retries skip resolution and the audit trail shows what was sent.
   */
  resolvedFromEns: { input: string; address: `0x${string}` } | null;
}

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getRpcUrl(): string {
  return process.env.BASE_RPC_URL || 'https://mainnet.base.org';
}

function getPublicClient() {
  return createPublicClient({ chain: base, transport: http(getRpcUrl()) });
}

let cachedAccount: PrivateKeyAccount | null = null;
function getPayoutAccount(): PrivateKeyAccount {
  if (cachedAccount) return cachedAccount;
  const raw = process.env.USDC_PAYOUT_WALLET_PRIVATE_KEY;
  if (!raw) {
    throw new Error(
      'USDC_PAYOUT_WALLET_PRIVATE_KEY not set. Generate a new key, add to Vercel env, and fund the address on Base.',
    );
  }
  const normalized = (raw.startsWith('0x') ? raw : `0x${raw}`).trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error('USDC_PAYOUT_WALLET_PRIVATE_KEY is not a valid 32-byte hex private key');
  }
  cachedAccount = privateKeyToAccount(normalized as `0x${string}`);
  return cachedAccount;
}

function getWalletClient() {
  return createWalletClient({ account: getPayoutAccount(), chain: base, transport: http(getRpcUrl()) });
}

/** Resolve the payout wallet's onchain address (derived from the private key). */
export function getPayoutWalletAddress(): `0x${string}` {
  return getPayoutAccount().address;
}

/** Read the live USDC balance (in USD, decimal) of the payout wallet on Base. */
export async function getPayoutWalletBalanceUsd(): Promise<{ address: `0x${string}`; balanceUsd: number }> {
  const address = getPayoutWalletAddress();
  const publicClient = getPublicClient();
  const balanceRaw = (await publicClient.readContract({
    address: USDC_BASE_ADDRESS,
    abi: ERC20_TRANSFER_ABI,
    functionName: 'balanceOf',
    args: [address],
  })) as bigint;
  return { address, balanceUsd: Number(balanceRaw) / 10 ** USDC_DECIMALS };
}

/**
 * Running 24h total of completed USDC payouts (used for daily-cap enforcement).
 * Pure read — does NOT include the in-flight payout being checked.
 *
 * prosciutto-92106: also require `transaction_hash` so zombie USDC rows
 * (status='paid' but no on-chain tx, e.g. legacy mark-paid that didn't gate
 * on proof) don't burn the daily cap and block legitimate sends. New rows
 * always have tx_hash by construction (executePayout writes it atomically
 * with status='paid'); older zombies need this filter to be excluded.
 */
export async function getUsdcUsedInLast24h(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.payout.findMany({
    where: {
      payoutMethod: 'usdc_base',
      status: 'paid',
      paidAt: { gt: since },
      transactionHash: { not: null, notIn: [''] },
    },
    select: { finalAmountUsd: true },
  });
  return rows.reduce((sum, r) => sum + Number(r.finalAmountUsd), 0);
}

export interface UsdcDailyCapStatus {
  usedUsd: number;
  capUsd: number;
  remainingUsd: number;
}

export async function getUsdcDailyCapStatus(): Promise<UsdcDailyCapStatus> {
  const capUsd = getEnvNumber('USDC_PAYOUT_DAILY_CAP_USD', DEFAULT_DAILY_CAP_USD);
  const usedUsd = await getUsdcUsedInLast24h();
  return {
    usedUsd,
    capUsd,
    remainingUsd: Math.max(0, capUsd - usedUsd),
  };
}

/**
 * bianco-89172: cumulative USDC paid to a single recipient wallet across all
 * parties + payouts. Used by the per-address hard cap pre-flight (below) and
 * by the admin warning endpoint that surfaces the same number in the UI.
 *
 * Sums `payouts.finalAmountUsd` where status='paid' AND payoutMethod='usdc_base'
 * AND payoutWalletAddress matches `toAddress` case-insensitively (wallets are
 * hex; mixed-case checksum addresses shouldn't slip through this check).
 */
export async function getPerAddressPaidTotalUsd(toAddress: string): Promise<number> {
  if (!toAddress) return 0;
  // prosciutto-92106: zombie USDC rows (status='paid' without transaction_hash)
  // shouldn't burn against the per-address cap — they never actually went
  // on-chain to that address. Filter on tx_hash presence so the cap reflects
  // real receipts.
  const sum = await prisma.payout.aggregate({
    where: {
      status: 'paid',
      payoutMethod: 'usdc_base',
      payoutWalletAddress: { equals: toAddress, mode: 'insensitive' },
      transactionHash: { not: null, notIn: [''] },
    },
    _sum: { finalAmountUsd: true },
  });
  return sum._sum.finalAmountUsd ? Number(sum._sum.finalAmountUsd.toString()) : 0;
}

/**
 * bianco-89172: same shape as `getPerAddressPaidTotalUsd` but also returns the
 * count of contributing rows so the admin UI can show "$X across N payouts".
 */
export async function getPerAddressPaidTotals(
  toAddress: string,
): Promise<{ paidUsd: number; paidCount: number }> {
  if (!toAddress) return { paidUsd: 0, paidCount: 0 };
  // prosciutto-92106: same proof gate as getPerAddressPaidTotalUsd — the
  // admin "Already paid to this wallet" warning shouldn't be misleading
  // because of zombie rows.
  const agg = await prisma.payout.aggregate({
    where: {
      status: 'paid',
      payoutMethod: 'usdc_base',
      payoutWalletAddress: { equals: toAddress, mode: 'insensitive' },
      transactionHash: { not: null, notIn: [''] },
    },
    _sum: { finalAmountUsd: true },
    _count: { _all: true },
  });
  return {
    paidUsd: agg._sum.finalAmountUsd ? Number(agg._sum.finalAmountUsd.toString()) : 0,
    paidCount: agg._count?._all ?? 0,
  };
}

/**
 * Send `amountUsd` USDC from the payout wallet to `toAddress` on Base.
 * Throws on any pre-flight failure or onchain revert. Caller must persist the
 * resulting `txHash` on the payout row.
 *
 * `opts.allowOverPerAddressCap` (bianco-89172): bypass the per-address $676
 * cumulative-paid pre-flight. Required when the admin has acknowledged the
 * warning in PayoutReviewModal / BulkSendModal. Default false.
 */
export async function sendUsdcPayment(
  toAddress: string,
  amountUsd: number,
  opts?: { allowOverPerAddressCap?: boolean },
): Promise<SendUsdcResult> {
  // 1. Address validation. caciotta-92104: also accept ENS names — older
  //    Payout rows (or any path that slipped past the write-side resolver)
  //    can carry an ENS string in `payoutWalletAddress`. Resolving here is
  //    defense-in-depth so the execute path never silently fails on a
  //    `.eth` recipient. Puebla's ariutokintumi.eth payout died this way
  //    (status -> failed) before this fix.
  if (!toAddress || typeof toAddress !== 'string') {
    throw new Error(`Invalid recipient address: ${toAddress}`);
  }
  const trimmedInput = toAddress.trim();
  let recipient: `0x${string}`;
  let resolvedFromEns: { input: string; address: `0x${string}` } | null = null;
  if (isAddress(trimmedInput)) {
    recipient = trimmedInput as `0x${string}`;
  } else if (looksLikeEnsName(trimmedInput)) {
    try {
      const resolved = await resolveEns(trimmedInput);
      recipient = resolved;
      resolvedFromEns = { input: trimmedInput, address: resolved };
      console.log(
        `[usdc-base] resolved ENS ${trimmedInput} -> ${resolved} via ETH mainnet`,
      );
    } catch (err: any) {
      // Surface a clear, machine-checkable error code so the admin UI can
      // distinguish "ENS lookup failed" from "address is malformed" or
      // "balance too low". The execute path catches this and writes the
      // message into the failed payout audit row.
      const reason = err?.message || 'ENS resolution failed';
      const e = new Error(
        `ENS_RESOLUTION_FAILED: could not resolve ${trimmedInput} on Ethereum mainnet (${reason}). ` +
          `Edit the wallet to a 0x address or a different ENS name and retry.`,
      );
      throw e;
    }
  } else {
    throw new Error(`Invalid recipient address: ${toAddress}`);
  }

  // 2. Amount range checks
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error(`Invalid payout amount: ${amountUsd}`);
  }
  const perTxCapUsd = getEnvNumber('USDC_PAYOUT_MAX_USD', DEFAULT_PER_TX_CAP_USD);
  if (amountUsd > perTxCapUsd) {
    throw new Error(
      `Amount $${amountUsd.toFixed(2)} exceeds per-tx cap of $${perTxCapUsd.toFixed(2)} (USDC_PAYOUT_MAX_USD)`,
    );
  }

  // 3. Hard ceiling — defense in depth even if env is misconfigured high
  if (amountUsd > HARD_PER_TX_CEILING_USD) {
    throw new Error(
      `Amount $${amountUsd.toFixed(2)} exceeds hard per-tx ceiling of $${HARD_PER_TX_CEILING_USD} (code constant)`,
    );
  }

  // 4. Balance pre-flight (also resolves wallet address used for `from`)
  const { address: fromAddress, balanceUsd } = await getPayoutWalletBalanceUsd();
  if (balanceUsd < amountUsd) {
    throw new Error(
      `Insufficient USDC balance: wallet has $${balanceUsd.toFixed(2)}, payout needs $${amountUsd.toFixed(2)} ` +
        `(fund ${fromAddress} on Base)`,
    );
  }

  // 5. Daily cap
  const dailyCapUsd = getEnvNumber('USDC_PAYOUT_DAILY_CAP_USD', DEFAULT_DAILY_CAP_USD);
  const usedUsd = await getUsdcUsedInLast24h();
  if (usedUsd + amountUsd > dailyCapUsd) {
    throw new Error(
      `Daily USDC cap exceeded: $${usedUsd.toFixed(2)} already paid in last 24h + $${amountUsd.toFixed(2)} > ` +
        `$${dailyCapUsd.toFixed(2)} cap (USDC_PAYOUT_DAILY_CAP_USD)`,
    );
  }

  // 6. Per-address cumulative cap (bianco-89172). Prevents double-paying the
  // same wallet across parties without an explicit admin ack. The override
  // path is gated by `opts.allowOverPerAddressCap` — the admin UI sets this
  // only when an admin has ticked the acknowledgement checkbox.
  if (!opts?.allowOverPerAddressCap) {
    const perAddressTotal = await getPerAddressPaidTotalUsd(recipient);
    if (perAddressTotal + amountUsd > PER_ADDRESS_HARD_CAP_USD) {
      throw new Error(
        `This wallet has already received $${perAddressTotal.toFixed(2)} USDC. ` +
          `Sending $${amountUsd.toFixed(2)} more would exceed the $${PER_ADDRESS_HARD_CAP_USD} per-address cap. ` +
          `Set allowOverPerAddressCap=true to acknowledge and proceed.`,
      );
    }
  }

  // Encode ERC-20 transfer calldata via viem
  const amountUnits = parseUnits(amountUsd.toFixed(USDC_DECIMALS), USDC_DECIMALS);
  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [recipient, amountUnits],
  });

  console.log(
    `[usdc-base] sending payout: from=${fromAddress} to=${recipient} amount=$${amountUsd.toFixed(2)} ` +
      `dailyUsed=$${usedUsd.toFixed(2)}/cap=$${dailyCapUsd.toFixed(2)} balance=$${balanceUsd.toFixed(2)}`,
  );

  // Sign + send directly via viem walletClient (no Privy in the path)
  const walletClient = getWalletClient();
  const txHash = await walletClient.sendTransaction({
    to: USDC_BASE_ADDRESS,
    data,
    value: 0n,
  });

  console.log(`[usdc-base] broadcast tx ${txHash}; waiting for receipt...`);

  // Wait for confirmation via public Base RPC
  const publicClient = getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: TX_RECEIPT_TIMEOUT_MS,
  });
  if (receipt.status !== 'success') {
    throw new Error(`USDC transfer reverted onchain: tx ${txHash}, status=${receipt.status}`);
  }

  console.log(`[usdc-base] confirmed tx ${txHash} block=${receipt.blockNumber}`);

  return {
    txHash,
    fromAddress,
    toAddress: recipient,
    amountUsd,
    resolvedFromEns,
  };
}
