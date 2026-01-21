import { useState, useCallback } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Validate required environment variables
const isMintingConfigured = (): boolean => {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
};

export type MintStatus = 'idle' | 'minting' | 'success' | 'error';

export interface MintResult {
  txHash?: string;
  tokenId?: string;
  error?: string;
  alreadyMinted?: boolean;
}

export interface MintNFTProps {
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
}

export function useMintNFT() {
  const [status, setStatus] = useState<MintStatus>('idle');
  const [result, setResult] = useState<MintResult>({});

  const mint = useCallback(async (props: MintNFTProps): Promise<MintResult> => {
    setStatus('minting');
    setResult({});

    // Validate configuration before attempting to mint
    if (!isMintingConfigured()) {
      const error = new Error('NFT minting is not configured. Missing Supabase environment variables.');
      setResult({ error: error.message });
      setStatus('error');
      throw error;
    }

    // Validate recipient address or ENS name format
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    const ensRegex = /^[a-zA-Z0-9-]+\.(eth|xyz|com|org|io|co|app|dev|id)$/;
    if (!ethAddressRegex.test(props.recipient) && !ensRegex.test(props.recipient)) {
      const error = new Error('Invalid wallet address or ENS name');
      setResult({ error: error.message });
      setStatus('error');
      throw error;
    }

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/mint-nft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(props),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Minting failed');
      }

      const mintResult: MintResult = {
        txHash: data.txHash,
        tokenId: data.tokenId,
        alreadyMinted: data.alreadyMinted || false,
      };

      setResult(mintResult);
      setStatus('success');
      return mintResult;
    } catch (err) {
      const errorResult: MintResult = {
        error: err instanceof Error ? err.message : 'Minting failed',
      };
      setResult(errorResult);
      setStatus('error');
      throw err;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setResult({});
  }, []);

  return { mint, status, result, reset };
}
