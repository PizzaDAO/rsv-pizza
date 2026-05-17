/**
 * One-shot Privy server-wallet provisioning for USDC payouts (arugula-38633, PR 5).
 *
 * Creates an Ethereum-chain Privy server-wallet that the backend will use to send
 * USDC on Base. Snax runs this ONCE per environment, then pastes the printed wallet
 * id into Vercel as `USDC_PAYOUT_PRIVY_WALLET_ID`, and funds the printed address
 * with USDC out-of-band from treasury.
 *
 * Idempotency: if `USDC_PAYOUT_PRIVY_WALLET_ID` is already set, the script refuses
 * to create another. Set `FORCE_NEW_WALLET=1` to override (rare — only when rotating).
 *
 * Usage:
 *   node scripts/create-payout-server-wallet.js
 *
 * Required env (loaded from backend/.env):
 *   - PRIVY_APP_ID
 *   - PRIVY_APP_SECRET
 *
 * Output: prints the new wallet's id + address + next-step instructions.
 *
 * DO NOT run this unless instructed. This creates a real Privy wallet that
 * will hold real funds.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });

async function main() {
  const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
  const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;
  const EXISTING = process.env.USDC_PAYOUT_PRIVY_WALLET_ID;
  const FORCE = process.env.FORCE_NEW_WALLET === '1';

  if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
    console.error('ERROR: PRIVY_APP_ID and PRIVY_APP_SECRET must be set in backend/.env');
    process.exit(1);
  }

  if (EXISTING && !FORCE) {
    console.error('REFUSING TO CREATE: USDC_PAYOUT_PRIVY_WALLET_ID is already set:');
    console.error('  ' + EXISTING);
    console.error('');
    console.error('If you really want to rotate the payout wallet, re-run with FORCE_NEW_WALLET=1.');
    console.error('Be aware: any USDC remaining on the OLD wallet will be stranded until you sweep.');
    process.exit(2);
  }

  // Lazy require so the env-check error path is fast even without deps installed.
  const { PrivyClient } = require('@privy-io/server-auth');
  const client = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);

  console.log('Creating new Privy server-wallet (chainType=ethereum)...');
  const wallet = await client.walletApi.createWallet({ chainType: 'ethereum' });

  console.log('');
  console.log('  Wallet ID:      ' + wallet.id);
  console.log('  Wallet Address: ' + wallet.address);
  console.log('  Chain Type:     ' + wallet.chainType);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Add to Vercel backend env (Production + Preview):');
  console.log('     USDC_PAYOUT_PRIVY_WALLET_ID=' + wallet.id);
  console.log('  2. Fund the wallet with USDC on Base (token 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913):');
  console.log('     send treasury USDC to ' + wallet.address);
  console.log('  3. (Recommended) Set caps in Vercel backend env:');
  console.log('     USDC_PAYOUT_MAX_USD=200');
  console.log('     USDC_PAYOUT_DAILY_CAP_USD=2000');
  console.log('  4. Verify the wallet balance with:');
  console.log('     node scripts/check-payout-wallet-balance.js');
  console.log('');
  console.log('Save the wallet id somewhere safe — if you lose it the wallet is orphaned in Privy.');
}

main().catch((err) => {
  console.error('Failed to create Privy server-wallet:', err);
  process.exit(3);
});
