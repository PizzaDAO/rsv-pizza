import React, { useState, useCallback } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { type Address, isAddress } from 'viem';
import { Copy, Check, ExternalLink, ChevronDown } from 'lucide-react';
import { useTokenBalances, type TokenBalance } from '../hooks/useTokenBalances';
import { useCryptoDonation } from '../hooks/useCryptoDonation';
import { TokenSelector } from './TokenSelector';
import { TransactionStatus } from './TransactionStatus';
import { SUPPORTED_TOKENS, getChainName, getExplorerUrl } from '../lib/tokens';
import { IconInput } from './IconInput';
import { createDonation } from '../lib/api';

// Default crypto donation address (fallback if host hasn't set one)
const DEFAULT_CRYPTO_ADDRESS = 'dreadpizzaroberts.eth';

interface CryptoDonationWidgetProps {
  partyId: string;
  cryptoAddress: string;
  suggestedAmounts?: number[];
  onSuccess?: () => void;
  guestId?: string;
  donorName?: string;
  donorEmail?: string;
  isAnonymous?: boolean;
  message?: string;
}

export const CryptoDonationWidget: React.FC<CryptoDonationWidgetProps> = ({
  partyId,
  cryptoAddress,
  onSuccess,
  guestId,
  donorName,
  donorEmail,
  isAnonymous,
  message,
}) => {
  const { address, chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const { balances, isLoading: balancesLoading } = useTokenBalances();
  const { status: txStatus, txHash, error: txError, sendDonation, reset: resetTx } = useCryptoDonation();

  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const [amount, setAmount] = useState('');
  const [showChainMenu, setShowChainMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  const recipientAddress = cryptoAddress || DEFAULT_CRYPTO_ADDRESS;

  // Resolve whether the recipient is a valid ETH address
  const isValidAddress = isAddress(recipientAddress);
  const isENS = recipientAddress.endsWith('.eth');
  const canSendTx = isValidAddress; // ENS needs resolution - for now we require a hex address

  const supportedChainIds = Object.keys(SUPPORTED_TOKENS).map(Number);

  const handleTokenSelect = useCallback((balance: TokenBalance) => {
    setSelectedToken(balance);
    setAmount('');
  }, []);

  const handleMaxAmount = useCallback(() => {
    if (!selectedToken) return;
    // For native ETH, leave a small buffer for gas
    if (selectedToken.token.address === null) {
      const maxBal = parseFloat(selectedToken.formatted);
      const withBuffer = Math.max(0, maxBal - 0.005);
      setAmount(withBuffer > 0 ? withBuffer.toFixed(6) : '0');
    } else {
      setAmount(selectedToken.formatted);
    }
  }, [selectedToken]);

  const handleSendDonation = useCallback(async () => {
    if (!selectedToken || !amount || !canSendTx) return;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;

    sendDonation({
      token: selectedToken.token,
      amount,
      recipientAddress: recipientAddress as Address,
    });
  }, [selectedToken, amount, recipientAddress, canSendTx, sendDonation]);

  // Record the donation in the backend after success
  const handleDone = useCallback(async () => {
    if (txHash && selectedToken && chainId) {
      try {
        await createDonation(partyId, {
          amount: parseFloat(amount),
          currency: selectedToken.token.symbol.toLowerCase(),
          donorName: isAnonymous ? undefined : (donorName || undefined),
          donorEmail: donorEmail || undefined,
          isAnonymous,
          message: message || undefined,
          guestId,
          paymentMethod: 'crypto',
          chainId,
          tokenSymbol: selectedToken.token.symbol,
          tokenAddress: selectedToken.token.address || undefined,
          txHash,
          walletAddress: address || undefined,
        });
      } catch {
        // Don't block the user even if recording fails
        console.error('Failed to record crypto donation in backend');
      }
    }
    onSuccess?.();
  }, [txHash, selectedToken, chainId, amount, partyId, donorName, donorEmail, isAnonymous, message, guestId, address, onSuccess]);

  const handleRetry = useCallback(() => {
    resetTx();
  }, [resetTx]);

  const handleCopyAddress = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(recipientAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }, [recipientAddress]);

  const handleSwitchChain = useCallback((newChainId: number) => {
    switchChain({ chainId: newChainId });
    setShowChainMenu(false);
    setSelectedToken(null);
    setAmount('');
  }, [switchChain]);

  // Transaction in progress or completed
  if (txStatus !== 'idle') {
    return (
      <TransactionStatus
        status={txStatus}
        txHash={txHash}
        chainId={chainId}
        error={txError}
        tokenSymbol={selectedToken?.token.symbol || ''}
        amount={amount}
        onDone={handleDone}
        onRetry={handleRetry}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Wallet Connection */}
      {!isConnected ? (
        <div className="space-y-4">
          <div className="flex justify-center">
            <ConnectKitButton.Custom>
              {({ show }) => (
                <button
                  type="button"
                  onClick={show}
                  className="w-full btn-primary flex items-center justify-center gap-2"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white">
                    <path d="M12 1.5L5.5 12.5L12 16.5L18.5 12.5L12 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M5.5 12.5L12 22.5L18.5 12.5L12 16.5L5.5 12.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Connect Wallet
                </button>
              )}
            </ConnectKitButton.Custom>
          </div>

          {/* Copy address fallback */}
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <p className="text-white/50 text-xs mb-2">Or send directly to:</p>
            <div className="flex items-center justify-between gap-2">
              <code className="text-[#ff393a] font-mono text-sm break-all">
                {recipientAddress}
              </code>
              <button
                type="button"
                onClick={handleCopyAddress}
                className="flex-shrink-0 p-2 hover:bg-white/10 rounded-lg transition-colors"
                title="Copy address"
              >
                {copied ? (
                  <Check size={16} className="text-[#39d98a]" />
                ) : (
                  <Copy size={16} className="text-white/60" />
                )}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Connected wallet header */}
          <div className="flex items-center justify-between">
            <ConnectKitButton.Custom>
              {({ show, truncatedAddress, ensName }) => (
                <button
                  type="button"
                  onClick={show}
                  className="flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors bg-white/5 px-3 py-1.5 rounded-full border border-white/10"
                >
                  <div className="w-2 h-2 rounded-full bg-[#39d98a]" />
                  {ensName || truncatedAddress}
                </button>
              )}
            </ConnectKitButton.Custom>

            {/* Chain switcher */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowChainMenu(!showChainMenu)}
                className="flex items-center gap-1 text-white/60 hover:text-white text-sm transition-colors bg-white/5 px-3 py-1.5 rounded-full border border-white/10"
              >
                {chainId ? getChainName(chainId) : 'Unknown'}
                <ChevronDown size={14} />
              </button>

              {showChainMenu && (
                <div className="absolute right-0 top-full mt-1 bg-[#1a1a2e] border border-white/10 rounded-xl overflow-hidden z-50 min-w-[140px] shadow-xl">
                  {supportedChainIds.map((cId) => (
                    <button
                      key={cId}
                      type="button"
                      onClick={() => handleSwitchChain(cId)}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors ${
                        chainId === cId ? 'text-[#ff393a]' : 'text-white/70'
                      }`}
                    >
                      {getChainName(cId)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recipient info */}
          <div className="bg-white/5 rounded-xl p-3 border border-white/10">
            <div className="flex items-center justify-between">
              <span className="text-white/40 text-xs">Sending to</span>
              <a
                href={`${getExplorerUrl(chainId || 1)}/address/${recipientAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/40 hover:text-white/60 transition-colors"
              >
                <ExternalLink size={12} />
              </a>
            </div>
            <code className="text-[#ff393a] font-mono text-xs break-all">
              {recipientAddress}
            </code>
          </div>

          {/* Unsupported chain warning */}
          {chainId && !supportedChainIds.includes(chainId) && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-yellow-400 text-sm">
              This chain is not supported. Please switch to Ethereum or Base.
            </div>
          )}

          {/* ENS without resolved address info */}
          {isENS && !isValidAddress && (
            <div className="bg-[#627eea]/10 border border-[#627eea]/30 rounded-xl p-3 text-[#627eea] text-sm">
              ENS names require a resolved address. Please ask the host to provide an Ethereum address.
            </div>
          )}

          {/* Token selector */}
          {chainId && supportedChainIds.includes(chainId) && (
            <>
              <div>
                <p className="text-white/40 text-xs mb-2">Select token</p>
                <TokenSelector
                  balances={balances}
                  isLoading={balancesLoading}
                  selectedSymbol={selectedToken?.token.symbol || null}
                  onSelect={handleTokenSelect}
                />
              </div>

              {/* Amount input */}
              {selectedToken && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <IconInput
                        icon={() => (
                          <span className="text-white/40 text-xs font-mono">
                            {selectedToken.token.symbol}
                          </span>
                        )}
                        type="number"
                        min={0}
                        step="any"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder={`Amount in ${selectedToken.token.symbol}`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleMaxAmount}
                      className="px-3 py-2 text-xs text-[#ff393a] hover:bg-[#ff393a]/10 rounded-lg border border-[#ff393a]/30 transition-colors"
                    >
                      Max
                    </button>
                  </div>
                  <p className="text-white/30 text-xs">
                    Balance: {parseFloat(selectedToken.formatted).toFixed(
                      selectedToken.token.decimals <= 6 ? 2 : 4
                    )} {selectedToken.token.symbol}
                  </p>
                </div>
              )}

              {/* Send button */}
              {selectedToken && amount && parseFloat(amount) > 0 && canSendTx && (
                <button
                  type="button"
                  onClick={handleSendDonation}
                  className="w-full btn-primary flex items-center justify-center gap-2"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-white">
                    <path d="M12 1.5L5.5 12.5L12 16.5L18.5 12.5L12 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M5.5 12.5L12 22.5L18.5 12.5L12 16.5L5.5 12.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Send {amount} {selectedToken.token.symbol}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
