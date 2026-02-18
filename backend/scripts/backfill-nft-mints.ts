import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Config from env
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv: string[]) {
  let dryRun = false;
  let partyId: string | null = null;
  let delay = 3000;

  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--party=')) {
      partyId = arg.replace('--party=', '');
    } else if (arg.startsWith('--delay=')) {
      const parsed = parseInt(arg.replace('--delay=', ''), 10);
      if (!isNaN(parsed) && parsed >= 0) delay = parsed;
    }
  }

  return { dryRun, partyId, delay };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  // ENS names: show as-is
  if (!addr.startsWith('0x')) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface GuestWithParty {
  id: string;
  name: string;
  ethereumAddress: string;
  party: {
    id: string;
    name: string;
    date: Date | null;
    venueName: string | null;
    address: string | null;
    eventImageUrl: string | null;
    inviteCode: string;
    nftChain: string | null;
  };
}

interface MintResponse {
  success?: boolean;
  alreadyMinted?: boolean;
  tokenId?: string;
  txHash?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const { dryRun, partyId, delay } = parseArgs(process.argv);

  // Validate env
  if (!SUPABASE_ANON_KEY) {
    console.error('Error: SUPABASE_ANON_KEY is required. Set it in your environment.');
    process.exit(1);
  }

  console.log('=== RSV.Pizza NFT Backfill ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Party filter: ${partyId || 'all nft-enabled parties'}`);
  console.log(`Delay between mints: ${delay}ms`);
  console.log();

  // Build the query filter
  const whereClause: any = {
    ethereumAddress: { not: null },
    nftTokenId: null,
    party: {
      nftEnabled: true,
    },
  };

  if (partyId) {
    whereClause.partyId = partyId;
  }

  // Fetch eligible guests
  const guests = (await prisma.guest.findMany({
    where: whereClause,
    include: {
      party: {
        select: {
          id: true,
          name: true,
          date: true,
          venueName: true,
          address: true,
          eventImageUrl: true,
          inviteCode: true,
          nftChain: true,
        },
      },
    },
    orderBy: [
      { party: { name: 'asc' } },
      { submittedAt: 'asc' },
    ],
  })) as unknown as GuestWithParty[];

  if (guests.length === 0) {
    console.log('No guests found with wallet address but no NFT. Nothing to do.');
    return;
  }

  // Group by party for the summary
  const byParty = new Map<string, GuestWithParty[]>();
  for (const guest of guests) {
    const key = guest.party.name;
    if (!byParty.has(key)) byParty.set(key, []);
    byParty.get(key)!.push(guest);
  }

  console.log(`Found ${guests.length} guest(s) with wallet address but no NFT`);
  for (const [partyName, partyGuests] of byParty) {
    console.log(`  ${partyName}: ${partyGuests.length} guest(s)`);
  }
  console.log();

  if (dryRun) {
    console.log('Dry run complete. No mints were performed.');
    console.log();
    console.log('Guests that would be minted:');
    for (let i = 0; i < guests.length; i++) {
      const g = guests[i];
      console.log(
        `  [${i + 1}/${guests.length}] ${g.name} (${truncateAddress(g.ethereumAddress)}) @ ${g.party.name}`
      );
    }
    return;
  }

  // Process each guest
  let newlyMinted = 0;
  let alreadyMinted = 0;
  let errors = 0;
  const failures: { name: string; address: string; error: string }[] = [];

  for (let i = 0; i < guests.length; i++) {
    const guest = guests[i];
    const label = `[${i + 1}/${guests.length}]`;

    console.log(
      `${label} Minting for ${guest.name} (${truncateAddress(guest.ethereumAddress)}) @ ${guest.party.name}...`
    );

    // Warn if no event image
    if (!guest.party.eventImageUrl) {
      console.log('  [warn] No eventImageUrl for this party. Passing empty string.');
    }

    // Build the payload matching MintRequest in the edge function
    const payload = {
      recipient: guest.ethereumAddress,
      partyId: guest.party.id,
      guestId: guest.id,
      guestName: guest.name,
      partyName: guest.party.name,
      partyDate: guest.party.date ? guest.party.date.toISOString() : null,
      partyVenue: guest.party.venueName || null,
      partyAddress: guest.party.address || null,
      imageUrl: guest.party.eventImageUrl || '',
      inviteCode: guest.party.inviteCode,
      chain: guest.party.nftChain || 'base',
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);

      const response = await fetch(`${SUPABASE_URL}/functions/v1/mint-nft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const data: MintResponse = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      if (data.alreadyMinted) {
        // Already minted on-chain, but missing from our DB
        console.log(
          `  -> Already minted on-chain. Token #${data.tokenId} (DB updated)`
        );
        alreadyMinted++;
      } else {
        console.log(
          `  -> Minted! Token #${data.tokenId}, tx: ${data.txHash || 'n/a'}`
        );
        newlyMinted++;
      }

      // Update the DB with the mint info
      if (data.tokenId) {
        await prisma.guest.update({
          where: { id: guest.id },
          data: {
            nftTokenId: parseInt(data.tokenId, 10),
            nftTransactionHash: data.txHash || null,
            nftMintedAt: new Date(),
          },
        });
      } else {
        console.log('  [warn] No tokenId in response. DB not updated.');
        errors++;
        failures.push({
          name: guest.name,
          address: guest.ethereumAddress,
          error: 'No tokenId in successful response',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  -> ERROR: ${message}`);
      errors++;
      failures.push({
        name: guest.name,
        address: guest.ethereumAddress,
        error: message,
      });
    }

    // Delay before next mint (skip after the last one)
    if (i < guests.length - 1 && delay > 0) {
      await sleep(delay);
    }
  }

  // Print summary
  console.log();
  console.log('=== Summary ===');
  console.log(`Total processed: ${guests.length}`);
  console.log(`Newly minted:    ${newlyMinted}`);
  console.log(`Already minted:  ${alreadyMinted}`);
  console.log(`Errors:          ${errors}`);

  if (failures.length > 0) {
    console.log();
    console.log('=== Failures ===');
    for (const f of failures) {
      console.log(`  ${f.name} (${truncateAddress(f.address)}): ${f.error}`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
