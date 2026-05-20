import { createPublicClient, http, isAddress } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';

/**
 * ENS lives on Ethereum mainnet — even when our payouts go out on Base,
 * we resolve names against L1 via the universal resolver. Uses a dedicated
 * read-only public client (no signer needed).
 *
 * Added by taleggio-30219: hosts can type `vitalik.eth` instead of a
 * 0x address when picking USDC on Base. We resolve at the API boundary
 * and persist the resolved 0x; the original ENS string is not stored.
 */
let cachedClient: ReturnType<typeof createPublicClient> | null = null;
function getMainnetClient() {
  if (cachedClient) return cachedClient;
  const rpc = process.env.ETH_MAINNET_RPC_URL || 'https://eth.llamarpc.com';
  cachedClient = createPublicClient({ chain: mainnet, transport: http(rpc) });
  return cachedClient;
}

// Looser than just `.eth` — supports subdomains like `alice.cb.id`.
const ENS_NAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function looksLikeEnsName(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.startsWith('0x')) return false;
  return ENS_NAME_RE.test(trimmed);
}

/**
 * Resolve an ENS name to its 0x address. Throws if the name doesn't resolve.
 * Returns the address checksummed by viem.
 */
export async function resolveEns(name: string): Promise<`0x${string}`> {
  const client = getMainnetClient();
  const normalized = normalize(name.trim());
  const addr = await client.getEnsAddress({ name: normalized });
  if (!addr || !isAddress(addr) || addr === '0x0000000000000000000000000000000000000000') {
    throw new Error(`ENS name ${name} does not resolve to an address`);
  }
  return addr;
}

/**
 * Accept a raw user-typed string and return a canonical 0x address.
 * - If the input is already a valid 0x address: returns it (lower-cased trim).
 * - If the input looks like an ENS name: resolves via mainnet.
 * - Otherwise: throws.
 *
 * Caller is responsible for converting the thrown Error into the correct
 * HTTP error (e.g. AppError 400 INVALID_WALLET_ADDRESS).
 */
export async function resolveWalletInput(input: string): Promise<`0x${string}`> {
  const trimmed = input.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return trimmed.toLowerCase() as `0x${string}`;
  }
  if (looksLikeEnsName(trimmed)) {
    return await resolveEns(trimmed);
  }
  throw new Error('Wallet address must be a 0x… address or an ENS name (e.g. alice.eth)');
}
