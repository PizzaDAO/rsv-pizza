/**
 * Deploy RSVPizzaNFT to Base
 *
 * Usage:
 *   1. Install deps: npm install viem
 *   2. Run: node deploy.js <PRIVATE_KEY>
 *
 * Or set MINTER_PRIVATE_KEY env var and run: node deploy.js
 */

const { createWalletClient, createPublicClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { base } = require('viem/chains');
const fs = require('fs');
const path = require('path');

// Contract bytecode and ABI (compiled with solc 0.8.20)
// You'll need to compile the contract first, or use this pre-compiled version

const RSVPIZZA_NFT_BYTECODE = '0x608060405234801561001057600080fd5b50338061003757604051631e4fbdf760e01b81526000600482015260240160405180910390fd5b61004081610067565b506001600555670de0b6b3a764000060065568056bc75e2d6310000060075561010f565b600080546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0telefonoa]';

async function deploy() {
  const privateKey = process.argv[2] || process.env.MINTER_PRIVATE_KEY;

  if (!privateKey) {
    console.error('Usage: node deploy.js <PRIVATE_KEY>');
    console.error('Or set MINTER_PRIVATE_KEY environment variable');
    process.exit(1);
  }

  const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

  console.log('Deploying RSVPizzaNFT to Base...');

  const account = privateKeyToAccount(formattedKey);
  console.log('Deployer address:', account.address);

  const publicClient = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org'),
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http('https://mainnet.base.org'),
  });

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log('Balance:', (Number(balance) / 1e18).toFixed(6), 'ETH');

  if (balance < BigInt(0.001 * 1e18)) {
    console.error('Insufficient balance. Need at least 0.001 ETH for deployment.');
    process.exit(1);
  }

  console.log('\\n⚠️  This script needs the compiled contract bytecode.');
  console.log('\\nEasiest method: Use Remix IDE');
  console.log('1. Go to https://remix.ethereum.org');
  console.log('2. Create new file: RSVPizzaNFT.sol');
  console.log('3. Paste the contract code from contracts/RSVPizzaNFT.sol');
  console.log('4. Compile with Solidity 0.8.20');
  console.log('5. Deploy tab → Environment: Injected Provider');
  console.log('6. Select Base network in your wallet');
  console.log('7. Deploy!');
  console.log('\\nThen set the contract address in:');
  console.log('- Supabase secrets: NFT_CONTRACT_ADDRESS');
  console.log('- Frontend .env: VITE_NFT_CONTRACT_ADDRESS');
}

deploy().catch(console.error);
