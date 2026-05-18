/**
 * Quick USDC-on-Base balance check for the rsv.pizza payout wallet
 * (arugula-38633, PR 5, self-custodied variant). Pure read — no transactions.
 *
 * Usage:
 *   node scripts/check-payout-wallet-balance.js
 *
 * Required env (loaded from backend/.env):
 *   - USDC_PAYOUT_WALLET_PRIVATE_KEY (rsv.pizza-specific hot wallet)
 *   - BASE_RPC_URL (optional; defaults to https://mainnet.base.org)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;

async function main() {
  const raw = process.env.USDC_PAYOUT_WALLET_PRIVATE_KEY;
  const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

  if (!raw) {
    console.error('ERROR: USDC_PAYOUT_WALLET_PRIVATE_KEY not set in backend/.env');
    process.exit(1);
  }
  const normalized = (raw.startsWith('0x') ? raw : '0x' + raw).trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    console.error('ERROR: USDC_PAYOUT_WALLET_PRIVATE_KEY is not a valid 32-byte hex private key');
    process.exit(1);
  }

  const { privateKeyToAccount } = require('viem/accounts');
  const { createPublicClient, http } = require('viem');
  const { base } = require('viem/chains');

  const account = privateKeyToAccount(normalized);
  console.log('Wallet Address: ' + account.address);
  console.log('RPC URL:        ' + RPC_URL);
  console.log('');

  const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });

  const balanceRaw = await publicClient.readContract({
    address: USDC_BASE,
    abi: [
      {
        inputs: [{ name: 'account', type: 'address' }],
        name: 'balanceOf',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    functionName: 'balanceOf',
    args: [account.address],
  });

  const balance = Number(balanceRaw) / 10 ** USDC_DECIMALS;
  console.log('USDC Balance:   $' + balance.toFixed(2));
}

main().catch((err) => {
  console.error('Failed to read wallet balance:', err.message);
  process.exit(2);
});
