import { useState, useCallback } from 'react';
import { useAccount, useSendTransaction, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { type Address, parseUnits } from 'viem';
import { type TokenInfo, ERC20_TRANSFER_ABI } from '../lib/tokens';

export type DonationStatus = 'idle' | 'sending' | 'confirming' | 'success' | 'error';

interface UseCryptoDonationReturn {
  status: DonationStatus;
  txHash: string | undefined;
  error: string | null;
  sendDonation: (params: {
    token: TokenInfo;
    amount: string;
    recipientAddress: Address;
  }) => void;
  reset: () => void;
}

/**
 * Hook for sending crypto donations.
 * Handles both native ETH transfers and ERC-20 token transfers.
 */
export function useCryptoDonation(): UseCryptoDonationReturn {
  const { chainId } = useAccount();
  const [status, setStatus] = useState<DonationStatus>('idle');
  const [txHash, setTxHash] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  // Native ETH transfer
  const { sendTransactionAsync } = useSendTransaction();

  // ERC-20 transfer
  const { writeContractAsync } = useWriteContract();

  // Wait for tx confirmation
  useWaitForTransactionReceipt({
    hash: txHash as `0x${string}` | undefined,
    query: {
      enabled: !!txHash && status === 'confirming',
    },
    onReplaced: () => {
      // Transaction was replaced (speed up or cancel)
      setStatus('error');
      setError('Transaction was replaced or cancelled');
    },
  });

  const sendDonation = useCallback(
    async (params: {
      token: TokenInfo;
      amount: string;
      recipientAddress: Address;
    }) => {
      const { token, amount, recipientAddress } = params;

      if (!chainId) {
        setError('Wallet not connected');
        setStatus('error');
        return;
      }

      setStatus('sending');
      setError(null);
      setTxHash(undefined);

      try {
        const parsedAmount = parseUnits(amount, token.decimals);

        let hash: `0x${string}`;

        if (token.address === null) {
          // Native ETH transfer
          hash = await sendTransactionAsync({
            to: recipientAddress,
            value: parsedAmount,
          });
        } else {
          // ERC-20 transfer
          hash = await writeContractAsync({
            address: token.address as Address,
            abi: ERC20_TRANSFER_ABI,
            functionName: 'transfer',
            args: [recipientAddress, parsedAmount],
          });
        }

        setTxHash(hash);
        setStatus('success');
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Transaction failed';

        // User rejected the transaction
        if (message.includes('User rejected') || message.includes('user rejected')) {
          setError('Transaction was rejected');
        } else if (message.includes('insufficient funds') || message.includes('exceeds balance')) {
          setError('Insufficient balance for this transaction');
        } else {
          setError(message.length > 120 ? message.slice(0, 120) + '...' : message);
        }
        setStatus('error');
      }
    },
    [chainId, sendTransactionAsync, writeContractAsync]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setTxHash(undefined);
    setError(null);
  }, []);

  return {
    status,
    txHash,
    error,
    sendDonation,
    reset,
  };
}
