import React from 'react';
import { Check, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { type DonationStatus } from '../hooks/useCryptoDonation';
import { getExplorerTxUrl, getChainName } from '../lib/tokens';

interface TransactionStatusProps {
  status: DonationStatus;
  txHash: string | undefined;
  chainId: number | undefined;
  error: string | null;
  tokenSymbol: string;
  amount: string;
  onDone: () => void;
  onRetry: () => void;
}

export const TransactionStatus: React.FC<TransactionStatusProps> = ({
  status,
  txHash,
  chainId,
  error,
  tokenSymbol,
  amount,
  onDone,
  onRetry,
}) => {
  if (status === 'sending') {
    return (
      <div className="text-center py-8 space-y-4">
        <div className="w-16 h-16 bg-[#627eea]/20 rounded-full flex items-center justify-center mx-auto border border-[#627eea]/30">
          <Loader2 className="w-8 h-8 text-[#627eea] animate-spin" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-theme-text mb-1">Confirm in Wallet</h3>
          <p className="text-theme-text-muted text-sm">
            Please confirm the transaction in your wallet
          </p>
        </div>
      </div>
    );
  }

  if (status === 'confirming') {
    return (
      <div className="text-center py-8 space-y-4">
        <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto border border-yellow-500/30">
          <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-theme-text mb-1">Transaction Pending</h3>
          <p className="text-theme-text-muted text-sm">
            Waiting for on-chain confirmation...
          </p>
        </div>
        {txHash && chainId && (
          <a
            href={getExplorerTxUrl(chainId, txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[#627eea] hover:text-[#627eea]/80 text-sm transition-colors"
          >
            <ExternalLink size={14} />
            View on {getChainName(chainId)}
          </a>
        )}
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="text-center py-8 space-y-4">
        <div className="w-16 h-16 bg-[#39d98a]/20 rounded-full flex items-center justify-center mx-auto border border-[#39d98a]/30">
          <Check className="w-8 h-8 text-[#39d98a]" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-theme-text mb-1">Thank You!</h3>
          <p className="text-theme-text-muted text-sm">
            Your donation of {amount} {tokenSymbol} has been sent.
          </p>
        </div>
        {txHash && chainId && (
          <a
            href={getExplorerTxUrl(chainId, txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[#627eea] hover:text-[#627eea]/80 text-sm transition-colors"
          >
            <ExternalLink size={14} />
            View Transaction
          </a>
        )}
        <button
          type="button"
          onClick={onDone}
          className="w-full btn-primary mt-4"
        >
          Done
        </button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="text-center py-8 space-y-4">
        <div className="w-16 h-16 bg-[#ff393a]/20 rounded-full flex items-center justify-center mx-auto border border-[#ff393a]/30">
          <AlertCircle className="w-8 h-8 text-[#ff393a]" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-theme-text mb-1">Transaction Failed</h3>
          <p className="text-theme-text-muted text-sm max-w-xs mx-auto">
            {error || 'Something went wrong. Please try again.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="w-full btn-primary"
        >
          Try Again
        </button>
      </div>
    );
  }

  return null;
};
