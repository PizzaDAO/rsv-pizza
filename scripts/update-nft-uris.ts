/**
 * One-time migration script: Update existing NFT token URIs from data URIs to API URLs
 *
 * Usage:
 *   MINTER_PRIVATE_KEY=0x... DATABASE_URL=... npx tsx scripts/update-nft-uris.ts
 *
 * This script:
 * 1. Queries all guests with nft_token_id IS NOT NULL
 * 2. For each, calls mintOrUpdate on the contract to update the tokenURI to the API URL
 */
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { PrismaClient } from '@prisma/client';

const MINTER_PRIVATE_KEY = process.env.MINTER_PRIVATE_KEY;
const BASE_NFT_CONTRACT_ADDRESS =
  process.env.BASE_NFT_CONTRACT_ADDRESS ||
  '0x2344044DfE7685041B2e5E0Aa6DB5277CEA0f76b';
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const BACKEND_URL = 'https://backend-pizza-dao.vercel.app';

if (!MINTER_PRIVATE_KEY) {
  console.error('MINTER_PRIVATE_KEY is required');
  process.exit(1);
}

const NFT_ABI = parseAbi([
  'function mintOrUpdate(address to, string eventId, string uri) external returns (uint256)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
]);

const prisma = new PrismaClient();

async function main() {
  // Find all guests with minted NFTs
  const guests = await prisma.guest.findMany({
    where: { nftTokenId: { not: null } },
    select: {
      id: true,
      name: true,
      ethereumAddress: true,
      nftTokenId: true,
      partyId: true,
      party: {
        select: { name: true },
      },
    },
  });

  console.log(`Found ${guests.length} minted NFTs to update`);

  if (guests.length === 0) {
    console.log('No NFTs to update');
    return;
  }

  const account = privateKeyToAccount(MINTER_PRIVATE_KEY as `0x${string}`);

  const publicClient = createPublicClient({
    chain: base,
    transport: http(BASE_RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(BASE_RPC_URL),
  });

  for (const guest of guests) {
    if (!guest.ethereumAddress) {
      console.log(
        `Skipping guest ${guest.id} (${guest.name}) - no ethereum address`
      );
      continue;
    }

    const newUri = `${BACKEND_URL}/api/nft/metadata/${guest.partyId}/${guest.ethereumAddress}`;

    // Check current URI
    try {
      const currentUri = await publicClient.readContract({
        address: BASE_NFT_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFT_ABI,
        functionName: 'tokenURI',
        args: [BigInt(guest.nftTokenId!)],
      });

      if (currentUri === newUri) {
        console.log(`Token ${guest.nftTokenId} already has API URL, skipping`);
        continue;
      }

      console.log(
        `Updating token ${guest.nftTokenId} for ${guest.name} (${guest.party.name})`
      );
      console.log(
        `  Old URI: ${(currentUri as string).substring(0, 80)}...`
      );
      console.log(`  New URI: ${newUri}`);
    } catch (e) {
      console.log(
        `Could not read current URI for token ${guest.nftTokenId}, proceeding anyway`
      );
    }

    // Call mintOrUpdate to update the URI
    try {
      const txHash = await walletClient.writeContract({
        address: BASE_NFT_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFT_ABI,
        functionName: 'mintOrUpdate',
        args: [
          guest.ethereumAddress as `0x${string}`,
          guest.partyId,
          newUri,
        ],
      });

      console.log(`  TX: ${txHash}`);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      console.log(`  Confirmed in block ${receipt.blockNumber}`);
    } catch (e) {
      console.error(`  Failed to update token ${guest.nftTokenId}:`, e);
    }
  }

  console.log('Done!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
