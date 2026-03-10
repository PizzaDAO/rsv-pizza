import React, { useState, useCallback, useEffect } from 'react';
import { useAccount, useSwitchChain, useEnsAddress } from 'wagmi';
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

  const [usdPrice, setUsdPrice] = useState<number | null>(null);

  const recipientAddress = cryptoAddress || DEFAULT_CRYPTO_ADDRESS;

  // Resolve whether the recipient is a valid ETH address or ENS name
  const isValidAddress = isAddress(recipientAddress);
  const isENS = recipientAddress.endsWith('.eth');

  // Resolve ENS name to address on mainnet
  const { data: resolvedEnsAddress, isLoading: ensLoading } = useEnsAddress({
    name: isENS ? recipientAddress : undefined,
    chainId: 1, // ENS resolves on mainnet
  });

  const effectiveAddress = isENS
    ? (resolvedEnsAddress || undefined)
    : (isValidAddress ? recipientAddress : undefined);
  const canSendTx = !!effectiveAddress;

  const supportedChainIds = Object.keys(SUPPORTED_TOKENS).map(Number);

  // CoinGecko ID mapping for USD price lookup
  const COINGECKO_IDS: Record<string, string> = {
    ETH: 'ethereum',
    WETH: 'ethereum',
    USDC: 'usd-coin',
    USDT: 'tether',
    DAI: 'dai',
    MON: 'monad',
  };

  // Fetch USD price when token changes
  useEffect(() => {
    if (!selectedToken) { setUsdPrice(null); return; }
    const symbol = selectedToken.token.symbol;
    // Stablecoins are ~$1
    if (['USDC', 'USDT', 'DAI'].includes(symbol)) {
      setUsdPrice(1);
      return;
    }
    const id = COINGECKO_IDS[symbol];
    if (!id) { setUsdPrice(null); return; }
    let cancelled = false;
    fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setUsdPrice(data[id]?.usd || null); })
      .catch(() => { if (!cancelled) setUsdPrice(null); });
    return () => { cancelled = true; };
  }, [selectedToken?.token.symbol]);

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
    if (!selectedToken || !amount || !canSendTx || !effectiveAddress) return;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;

    sendDonation({
      token: selectedToken.token,
      amount,
      recipientAddress: effectiveAddress as Address,
    });
  }, [selectedToken, amount, effectiveAddress, canSendTx, sendDonation]);

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
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-theme-text">
                    <path d="M12 1.5L5.5 12.5L12 16.5L18.5 12.5L12 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M5.5 12.5L12 22.5L18.5 12.5L12 16.5L5.5 12.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Connect Wallet
                </button>
              )}
            </ConnectKitButton.Custom>
          </div>

          {/* Copy address fallback */}
          <div className="bg-theme-surface rounded-xl p-4 border border-theme-stroke">
            <p className="text-theme-text-muted text-xs mb-2">Or send directly to:</p>
            <div className="flex items-center justify-between gap-2">
              <code className="text-[#ff393a] font-mono text-sm break-all">
                {recipientAddress}
              </code>
              <button
                type="button"
                onClick={handleCopyAddress}
                className="flex-shrink-0 p-2 hover:bg-theme-surface-hover rounded-lg transition-colors"
                title="Copy address"
              >
                {copied ? (
                  <Check size={16} className="text-[#39d98a]" />
                ) : (
                  <Copy size={16} className="text-theme-text-secondary" />
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
                  className="flex items-center gap-2 text-theme-text-secondary hover:text-theme-text text-sm transition-colors bg-theme-surface px-3 py-1.5 rounded-full border border-theme-stroke"
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
                className="flex items-center gap-1 text-theme-text-secondary hover:text-theme-text text-sm transition-colors bg-theme-surface px-3 py-1.5 rounded-full border border-theme-stroke"
              >
                {chainId ? getChainName(chainId) : 'Unknown'}
                <ChevronDown size={14} />
              </button>

              {showChainMenu && (
                <div className="absolute right-0 top-full mt-1 bg-theme-header border border-theme-stroke rounded-xl overflow-hidden z-50 min-w-[140px] shadow-xl">
                  {supportedChainIds.map((cId) => (
                    <button
                      key={cId}
                      type="button"
                      onClick={() => handleSwitchChain(cId)}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-theme-surface-hover transition-colors ${
                        chainId === cId ? 'text-[#ff393a]' : 'text-theme-text-secondary'
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
          <div className="bg-theme-surface rounded-xl p-3 border border-theme-stroke">
            <div className="flex items-center justify-between">
              <span className="text-theme-text-muted text-xs">Sending to</span>
              {effectiveAddress && (
                <a
                  href={`${getExplorerUrl(chainId || 1)}/address/${effectiveAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-theme-text-muted hover:text-theme-text-secondary transition-colors"
                >
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
            {isENS && (
              <p className="text-theme-text-secondary text-sm font-medium mb-1">{recipientAddress}</p>
            )}
            {ensLoading && isENS && (
              <p className="text-theme-text-muted text-xs">Resolving ENS name...</p>
            )}
            {effectiveAddress && (
              <code className="text-[#ff393a] font-mono text-xs break-all">
                {effectiveAddress}
              </code>
            )}
            {!effectiveAddress && !ensLoading && isENS && (
              <p className="text-yellow-400 text-xs">Could not resolve ENS name</p>
            )}
            {!isENS && !isValidAddress && (
              <code className="text-[#ff393a] font-mono text-xs break-all">
                {recipientAddress}
              </code>
            )}
          </div>

          {/* Unsupported chain warning */}
          {chainId && !supportedChainIds.includes(chainId) && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-yellow-400 text-sm">
              This chain is not supported. Please switch to Ethereum, Base, or Monad.
            </div>
          )}

          {/* ENS resolution failed */}
          {isENS && !ensLoading && !resolvedEnsAddress && (
            <div className="bg-[#627eea]/10 border border-[#627eea]/30 rounded-xl p-3 text-[#627eea] text-sm">
              Could not resolve ENS name. You can still copy the address and send manually.
            </div>
          )}

          {/* Token selector */}
          {chainId && supportedChainIds.includes(chainId) && (
            <>
              <div>
                <p className="text-theme-text-muted text-xs mb-2">Select token</p>
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
                          <span className="text-theme-text-muted text-xs font-mono">
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
                  <div className="flex items-center justify-between">
                    <p className="text-theme-text-faint text-xs">
                      Balance: {parseFloat(selectedToken.formatted).toFixed(
                        selectedToken.token.decimals <= 6 ? 2 : 4
                      )} {selectedToken.token.symbol}
                    </p>
                    {usdPrice && amount && parseFloat(amount) > 0 && (
                      <p className="text-theme-text-muted text-xs">
                        &asymp; ${(parseFloat(amount) * usdPrice).toFixed(2)} USD
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Send button */}
              {selectedToken && (
                <button
                  type="button"
                  onClick={handleSendDonation}
                  disabled={!amount || parseFloat(amount) <= 0 || !canSendTx || ensLoading}
                  className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-theme-text">
                    <path d="M12 1.5L5.5 12.5L12 16.5L18.5 12.5L12 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M5.5 12.5L12 22.5L18.5 12.5L12 16.5L5.5 12.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Send {amount && parseFloat(amount) > 0 ? `${amount} ${selectedToken.token.symbol}` : selectedToken.token.symbol}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
