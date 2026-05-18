/**
 * USDC-on-Base payment service (arugula-38633, PR 5).
 *
 * Sends USDC from a Privy server-wallet to a recipient on Base mainnet. The
 * wallet itself is provisioned out-of-band by `scripts/create-payout-server-wallet.js`;
 * this service only signs and broadcasts transfers against the existing wallet id
 * stored in `USDC_PAYOUT_PRIVY_WALLET_ID`.
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
 * NEVER logs private keys (Privy holds them); does log addresses + amounts +
 * tx hashes for auditability.
 */
import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseUnits,
  isAddress,
  type Hex,
} from 'viem';
import { base } from 'viem/chains';
import { PrivyClient } from '@privy-io/server-auth';
import { prisma } from '../config/database.js';

const USDC_BASE_ADDRESS: Hex = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;
const BASE_CAIP2 = 'eip155:8453' as const;
const HARD_PER_TX_CEILING_USD = 1000;
const DEFAULT_PER_TX_CAP_USD = 200;
const DEFAULT_DAILY_CAP_USD = 2000;
const TX_RECEIPT_TIMEOUT_MS = 90_000;

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

let privyClient: PrivyClient | null = null;
function getPrivyClient(): PrivyClient {
  if (privyClient) return privyClient;
  const id = process.env.PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  if (!id || !secret) {
    throw new Error('Privy credentials missing (PRIVY_APP_ID / PRIVY_APP_SECRET)');
  }
  privyClient = new PrivyClient(id, secret);
  return privyClient;
}

function getPayoutWalletId(): string {
  const id = process.env.USDC_PAYOUT_PRIVY_WALLET_ID;
  if (!id) {
    throw new Error(
      'USDC_PAYOUT_PRIVY_WALLET_ID not set. Run scripts/create-payout-server-wallet.js and add the result to Vercel env.',
    );
  }
  return id;
}

/** Fetch the payout server-wallet's on-chain address from Privy. */
async function getPayoutWalletAddress(): Promise<`0x${string}`> {
  const wallet = await getPrivyClient().walletApi.getWallet({ id: getPayoutWalletId() });
  if (!wallet.address || !isAddress(wallet.address)) {
    throw new Error(`Privy returned no/invalid address for wallet ${getPayoutWalletId()}`);
  }
  return wallet.address as `0x${string}`;
}

/** Read the live USDC balance (in USD, decimal) of the payout wallet on Base. */
export async function getPayoutWalletBalanceUsd(): Promise<{ address: `0x${string}`; balanceUsd: number }> {
  const address = await getPayoutWalletAddress();
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
 */
export async function getUsdcUsedInLast24h(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.payout.findMany({
    where: {
      payoutMethod: 'usdc_base',
      status: 'paid',
      paidAt: { gt: since },
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
 * Send `amountUsd` USDC from the payout server-wallet to `toAddress` on Base.
 * Throws on any pre-flight failure or on-chain revert. Caller must persist the
 * resulting `txHash` on the payout row.
 */
export async function sendUsdcPayment(toAddress: string, amountUsd: number): Promise<SendUsdcResult> {
  // 1. Address validation
  if (!toAddress || !isAddress(toAddress)) {
    throw new Error(`Invalid recipient address: ${toAddress}`);
  }
  const recipient = toAddress as `0x${string}`;

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

  // Sign + send via Privy server-wallet (broadcasts onto Base for us)
  const privy = getPrivyClient();
  const sendResult = await privy.walletApi.ethereum.sendTransaction({
    walletId: getPayoutWalletId(),
    caip2: BASE_CAIP2,
    transaction: {
      to: USDC_BASE_ADDRESS,
      data,
      value: '0x0',
    },
  });

  const txHash = sendResult.hash as `0x${string}`;
  console.log(`[usdc-base] broadcast tx ${txHash}; waiting for receipt...`);

  // Wait for confirmation via public Base RPC (Privy returns hash but not receipt)
  const publicClient = getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: TX_RECEIPT_TIMEOUT_MS,
  });
  if (receipt.status !== 'success') {
    throw new Error(`USDC transfer reverted on-chain: tx ${txHash}, status=${receipt.status}`);
  }

  console.log(`[usdc-base] confirmed tx ${txHash} block=${receipt.blockNumber}`);

  return {
    txHash,
    fromAddress,
    toAddress: recipient,
    amountUsd,
  };
}
