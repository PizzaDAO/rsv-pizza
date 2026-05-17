/**
 * Quick USDC-on-Base balance check for the payout server-wallet
 * (arugula-38633, PR 5). Pure read — no transactions.
 *
 * Usage:
 *   node scripts/check-payout-wallet-balance.js
 *
 * Required env (loaded from backend/.env):
 *   - PRIVY_APP_ID
 *   - PRIVY_APP_SECRET
 *   - USDC_PAYOUT_PRIVY_WALLET_ID (created by scripts/create-payout-server-wallet.js)
 *   - BASE_RPC_URL (optional; defaults to https://mainnet.base.org)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;

async function main() {
  const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
  const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;
  const WALLET_ID = process.env.USDC_PAYOUT_PRIVY_WALLET_ID;
  const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

  if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
    console.error('ERROR: PRIVY_APP_ID and PRIVY_APP_SECRET must be set in backend/.env');
    process.exit(1);
  }
  if (!WALLET_ID) {
    console.error('ERROR: USDC_PAYOUT_PRIVY_WALLET_ID not set. Run scripts/create-payout-server-wallet.js first.');
    process.exit(1);
  }

  const { PrivyClient } = require('@privy-io/server-auth');
  const { createPublicClient, http } = require('viem');
  const { base } = require('viem/chains');

  const client = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);
  const wallet = await client.walletApi.getWallet({ id: WALLET_ID });

  console.log('Wallet ID:      ' + wallet.id);
  console.log('Wallet Address: ' + wallet.address);
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
    args: [wallet.address],
  });

  const balance = Number(balanceRaw) / 10 ** USDC_DECIMALS;
  console.log('USDC Balance:   $' + balance.toFixed(2));
}

main().catch((err) => {
  console.error('Failed to read wallet balance:', err);
  process.exit(2);
});
