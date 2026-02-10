import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createPublicClient, createWalletClient, http, parseAbi, defineChain } from 'https://esm.sh/viem@2.21.0';
import { privateKeyToAccount } from 'https://esm.sh/viem@2.21.0/accounts';
import { base, mainnet } from 'https://esm.sh/viem@2.21.0/chains';
import { normalize } from 'https://esm.sh/viem@2.21.0/ens';

const MINTER_PRIVATE_KEY = Deno.env.get('MINTER_PRIVATE_KEY') || '';
const BASE_NFT_CONTRACT_ADDRESS = Deno.env.get('BASE_NFT_CONTRACT_ADDRESS') || Deno.env.get('NFT_CONTRACT_ADDRESS') || '';
const BASE_RPC_URL = Deno.env.get('BASE_RPC_URL') || 'https://mainnet.base.org';
const MONAD_NFT_CONTRACT_ADDRESS = Deno.env.get('MONAD_NFT_CONTRACT_ADDRESS') || '';
const MONAD_RPC_URL = Deno.env.get('MONAD_RPC_URL') || 'https://rpc.monad.xyz';

// Monad chain definition (not yet built into viem)
const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.monad.xyz'] },
  },
});

// Chain configuration map
const CHAIN_CONFIG = {
  base: {
    chain: base,
    contractAddress: BASE_NFT_CONTRACT_ADDRESS,
    rpcUrl: BASE_RPC_URL,
  },
  monad: {
    chain: monad,
    contractAddress: MONAD_NFT_CONTRACT_ADDRESS,
    rpcUrl: MONAD_RPC_URL,
  },
} as const;

type SupportedChain = keyof typeof CHAIN_CONFIG;

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://rsv.pizza',
  'https://www.rsv.pizza',
  'http://localhost:5173',
  'http://localhost:5176',
  'http://localhost:3000',
];

const getCorsHeaders = (origin: string | null) => {
  // Allow Vercel preview deployments and whitelisted origins
  const allowedOrigin = origin && (
    ALLOWED_ORIGINS.includes(origin) ||
    origin.endsWith('.vercel.app')
  ) ? origin : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
};

const NFT_ABI = parseAbi([
  'function mintOrUpdate(address to, string eventId, string uri) external returns (uint256)',
  'function hasToken(address owner, string eventId) external view returns (bool)',
  'function tokenOfOwner(address owner, string eventId) external view returns (uint256)',
]);

interface MintRequest {
  recipient: string;
  partyId: string;
  guestId: string;
  guestName: string;
  partyName: string;
  partyDate: string | null;
  partyVenue: string | null;
  partyAddress: string | null;
  imageUrl: string;
  inviteCode: string;
  chain?: SupportedChain;
}

serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!MINTER_PRIVATE_KEY) {
      return new Response(
        JSON.stringify({ error: 'NFT minting not configured (missing minter key)' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const request: MintRequest = await req.json();
    const { recipient, partyId } = request;

    // Select chain config (default to base for backwards compatibility)
    const selectedChain: SupportedChain = request.chain || 'base';
    if (!CHAIN_CONFIG[selectedChain]) {
      return new Response(
        JSON.stringify({ error: `Unsupported chain: ${selectedChain}. Supported: ${Object.keys(CHAIN_CONFIG).join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const chainConfig = CHAIN_CONFIG[selectedChain];
    if (!chainConfig.contractAddress) {
      return new Response(
        JSON.stringify({ error: `NFT contract not configured for chain: ${selectedChain}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate recipient address or ENS name
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    const ensRegex = /^[a-zA-Z0-9-]+\.(eth|xyz|com|org|io|co|app|dev|id)$/;

    if (!recipient || (!ethAddressRegex.test(recipient) && !ensRegex.test(recipient))) {
      return new Response(
        JSON.stringify({ error: 'Invalid wallet address or ENS name' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Resolve ENS name to address if needed
    let resolvedAddress = recipient;
    if (ensRegex.test(recipient)) {
      try {
        const mainnetClient = createPublicClient({
          chain: mainnet,
          transport: http('https://eth.llamarpc.com'),
        });
        const ensAddress = await mainnetClient.getEnsAddress({
          name: normalize(recipient),
        });
        if (!ensAddress) {
          return new Response(
            JSON.stringify({ error: `Could not resolve ENS name: ${recipient}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        resolvedAddress = ensAddress;
        console.log(`Resolved ${recipient} to ${resolvedAddress}`);
      } catch (e) {
        console.error('ENS resolution failed:', e);
        return new Response(
          JSON.stringify({ error: `Failed to resolve ENS name: ${recipient}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Setup viem public client early for idempotency check
    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    // Idempotency check: see if wallet already has an NFT for this event
    try {
      const hasExistingToken = await publicClient.readContract({
        address: chainConfig.contractAddress as `0x${string}`,
        abi: NFT_ABI,
        functionName: 'hasToken',
        args: [resolvedAddress as `0x${string}`, partyId],
      });

      if (hasExistingToken) {
        // Get existing token ID
        const existingTokenId = await publicClient.readContract({
          address: chainConfig.contractAddress as `0x${string}`,
          abi: NFT_ABI,
          functionName: 'tokenOfOwner',
          args: [resolvedAddress as `0x${string}`, partyId],
        });

        return new Response(
          JSON.stringify({
            success: true,
            alreadyMinted: true,
            tokenId: existingTokenId.toString(),
            message: 'NFT already exists for this wallet and event',
            chain: selectedChain,
            chainId: chainConfig.chain.id,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (e) {
      // If hasToken fails, proceed with minting (contract might not support this function)
      console.log('Could not check existing token, proceeding with mint:', e);
    }

    // Use API URL for metadata - allows metadata to auto-update when event details change
    const metadataUri = `https://backend-pizza-dao.vercel.app/api/nft/metadata/${partyId}/${resolvedAddress}`;

    // Setup wallet client for minting (publicClient already created above)
    const account = privateKeyToAccount(MINTER_PRIVATE_KEY as `0x${string}`);

    const walletClient = createWalletClient({
      account,
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    // Mint the NFT
    const txHash = await walletClient.writeContract({
      address: chainConfig.contractAddress as `0x${string}`,
      abi: NFT_ABI,
      functionName: 'mintOrUpdate',
      args: [resolvedAddress as `0x${string}`, partyId, metadataUri],
    });

    // Wait for transaction receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Get token ID from the contract
    let tokenId: string | null = null;
    try {
      const tokenIdBigInt = await publicClient.readContract({
        address: chainConfig.contractAddress as `0x${string}`,
        abi: NFT_ABI,
        functionName: 'tokenOfOwner',
        args: [resolvedAddress as `0x${string}`, partyId],
      });
      tokenId = tokenIdBigInt.toString();
    } catch (e) {
      console.error('Failed to get token ID:', e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        txHash,
        tokenId,
        blockNumber: receipt.blockNumber.toString(),
        chain: selectedChain,
        chainId: chainConfig.chain.id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('NFT minting error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
