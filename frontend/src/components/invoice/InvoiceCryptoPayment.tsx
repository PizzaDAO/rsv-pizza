import React, { useState, useCallback, useEffect } from 'react';
import { useAccount, useSwitchChain, useEnsAddress } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { type Address, isAddress } from 'viem';
import { Copy, Check, ExternalLink, ChevronDown, Loader2 } from 'lucide-react';
import { useTokenBalances, type TokenBalance } from '../../hooks/useTokenBalances';
import { useCryptoDonation } from '../../hooks/useCryptoDonation';
import { TokenSelector } from '../TokenSelector';
import { TransactionStatus } from '../TransactionStatus';
import { SUPPORTED_TOKENS, getChainName, getExplorerUrl } from '../../lib/tokens';
import { IconInput } from '../IconInput';
import { payInvoice } from '../../lib/api';
import { Invoice } from '../../types';

// Default crypto payment address
const DEFAULT_CRYPTO_ADDRESS = 'dreadpizzaroberts.eth';

// Extract crypto address from paymentInstructions if available
function extractCryptoAddress(paymentInstructions: string | null): string {
  if (!paymentInstructions) return DEFAULT_CRYPTO_ADDRESS;

  // Look for ENS names (e.g., "dreadpizzaroberts.eth")
  const ensMatch = paymentInstructions.match(/[\w.-]+\.eth\b/i);
  if (ensMatch) return ensMatch[0];

  // Look for Ethereum addresses (0x...)
  const ethMatch = paymentInstructions.match(/0x[a-fA-F0-9]{40}/);
  if (ethMatch) return ethMatch[0];

  return DEFAULT_CRYPTO_ADDRESS;
}

interface InvoiceCryptoPaymentProps {
  invoice: Invoice;
  onSuccess: (updatedInvoice: Invoice) => void;
}

export const InvoiceCryptoPayment: React.FC<InvoiceCryptoPaymentProps> = ({
  invoice,
  onSuccess,
}) => {
  const { address, chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const { balances, isLoading: balancesLoading } = useTokenBalances();
  const { status: txStatus, txHash, error: txError, sendDonation, reset: resetTx } = useCryptoDonation();

  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const [amount, setAmount] = useState('');
  const [showChainMenu, setShowChainMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  const recipientAddress = extractCryptoAddress(invoice.paymentInstructions);

  // Resolve whether the recipient is a valid ETH address or ENS name
  const isValidAddress = isAddress(recipientAddress);
  const isENS = recipientAddress.endsWith('.eth');

  // Resolve ENS name to address on mainnet
  const { data: resolvedEnsAddress, isLoading: ensLoading } = useEnsAddress({
    name: isENS ? recipientAddress : undefined,
    chainId: 1,
  });

  const effectiveAddress = isENS
    ? (resolvedEnsAddress || undefined)
    : (isValidAddress ? recipientAddress : undefined);
  const canSendTx = !!effectiveAddress;

  const supportedChainIds = Object.keys(SUPPORTED_TOKENS).map(Number);

  // Pre-populate amount from invoice total (converted from cents to USDC units)
  useEffect(() => {
    if (selectedToken && !amount) {
      const symbol = selectedToken.token.symbol;
      // For stablecoins, set the invoice amount in dollars
      if (['USDC', 'USDT', 'DAI'].includes(symbol)) {
        setAmount((invoice.total / 100).toFixed(2));
      }
    }
  }, [selectedToken, invoice.total, amount]);

  // Auto-select USDC if available on current chain
  useEffect(() => {
    if (isConnected && balances.length > 0 && !selectedToken) {
      const usdc = balances.find(b => b.token.symbol === 'USDC');
      if (usdc) {
        setSelectedToken(usdc);
      }
    }
  }, [isConnected, balances, selectedToken]);

  const handleTokenSelect = useCallback((balance: TokenBalance) => {
    setSelectedToken(balance);
    setAmount('');
  }, []);

  const handleMaxAmount = useCallback(() => {
    if (!selectedToken) return;
    if (selectedToken.token.address === null) {
      const maxBal = parseFloat(selectedToken.formatted);
      const withBuffer = Math.max(0, maxBal - 0.005);
      setAmount(withBuffer > 0 ? withBuffer.toFixed(6) : '0');
    } else {
      setAmount(selectedToken.formatted);
    }
  }, [selectedToken]);

  const handleSendPayment = useCallback(async () => {
    if (!selectedToken || !amount || !canSendTx || !effectiveAddress) return;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;

    sendDonation({
      token: selectedToken.token,
      amount,
      recipientAddress: effectiveAddress as Address,
    });
  }, [selectedToken, amount, effectiveAddress, canSendTx, sendDonation]);

  // Record payment in backend after successful tx
  const handleDone = useCallback(async () => {
    if (txHash && selectedToken && chainId) {
      setRecordingPayment(true);
      setRecordError(null);
      try {
        const result = await payInvoice(invoice.viewToken, {
          paymentMethod: selectedToken.token.symbol === 'USDC' ? 'usdc' : 'crypto',
          paymentRef: txHash,
          paidAmount: invoice.total,
          chainId,
          tokenSymbol: selectedToken.token.symbol,
        });

        if (result?.invoice) {
          onSuccess(result.invoice);
        }
      } catch (err) {
        console.error('Failed to record payment:', err);
        setRecordError('Payment sent successfully, but we could not update the invoice status. Please contact the event host with your transaction hash.');
      }
      setRecordingPayment(false);
    }
  }, [txHash, selectedToken, chainId, invoice.viewToken, invoice.total, onSuccess]);

  const handleRetry = useCallback(() => {
    resetTx();
    setRecordError(null);
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
      <div className="space-y-4">
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
        {recordingPayment && (
          <div className="flex items-center justify-center gap-2 text-white/60 text-sm">
            <Loader2 size={14} className="animate-spin" />
            Recording payment...
          </div>
        )}
        {recordError && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-yellow-400 text-sm">
            {recordError}
            {txHash && (
              <p className="mt-2 font-mono text-xs break-all">
                Tx: {txHash}
              </p>
            )}
          </div>
        )}
      </div>
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
                  className="w-full bg-[#627eea] hover:bg-[#627eea]/90 text-white font-semibold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
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
          <div className="bg-[#0f0f23] rounded-xl p-4 border border-white/10">
            <p className="text-white/50 text-xs mb-2">Or send directly to:</p>
            <div className="flex items-center justify-between gap-2">
              <code className="text-[#ff393a] font-mono text-sm break-all">
                {recipientAddress}
              </code>
              <button
                type="button"
                onClick={handleCopyAddress}
                className="flex-shrink-0 p-2 hover:bg-white/5 rounded-lg transition-colors"
                title="Copy address"
              >
                {copied ? (
                  <Check size={16} className="text-[#39d98a]" />
                ) : (
                  <Copy size={16} className="text-white/50" />
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
                  className="flex items-center gap-2 text-white/60 hover:text-white/80 text-sm transition-colors bg-[#0f0f23] px-3 py-1.5 rounded-full border border-white/10"
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
                className="flex items-center gap-1 text-white/60 hover:text-white/80 text-sm transition-colors bg-[#0f0f23] px-3 py-1.5 rounded-full border border-white/10"
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
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors ${
                        chainId === cId ? 'text-[#ff393a]' : 'text-white/60'
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
          <div className="bg-[#0f0f23] rounded-xl p-3 border border-white/10">
            <div className="flex items-center justify-between">
              <span className="text-white/40 text-xs">Sending to</span>
              {effectiveAddress && (
                <a
                  href={`${getExplorerUrl(chainId || 1)}/address/${effectiveAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/40 hover:text-white/60 transition-colors"
                >
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
            {isENS && (
              <p className="text-white/70 text-sm font-medium mb-1">{recipientAddress}</p>
            )}
            {ensLoading && isENS && (
              <p className="text-white/40 text-xs">Resolving ENS name...</p>
            )}
            {effectiveAddress && (
              <code className="text-[#ff393a] font-mono text-xs break-all">
                {effectiveAddress}
              </code>
            )}
            {!effectiveAddress && !ensLoading && isENS && (
              <p className="text-yellow-400 text-xs">Could not resolve ENS name</p>
            )}
          </div>

          {/* Unsupported chain warning */}
          {chainId && !supportedChainIds.includes(chainId) && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-yellow-400 text-sm">
              This chain is not supported. Please switch to Ethereum, Base, or Monad.
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
                  <div className="flex items-center justify-between">
                    <p className="text-white/30 text-xs">
                      Balance: {parseFloat(selectedToken.formatted).toFixed(
                        selectedToken.token.decimals <= 6 ? 2 : 4
                      )} {selectedToken.token.symbol}
                    </p>
                    <p className="text-white/40 text-xs">
                      Invoice: ${(invoice.total / 100).toFixed(2)} USD
                    </p>
                  </div>
                </div>
              )}

              {/* Send button */}
              {selectedToken && (
                <button
                  type="button"
                  onClick={handleSendPayment}
                  disabled={!amount || parseFloat(amount) <= 0 || !canSendTx || ensLoading}
                  className="w-full bg-[#627eea] hover:bg-[#627eea]/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-white">
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
