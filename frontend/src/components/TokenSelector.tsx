import React from 'react';
import { Loader2 } from 'lucide-react';
import { type TokenBalance } from '../hooks/useTokenBalances';

interface TokenSelectorProps {
  balances: TokenBalance[];
  isLoading: boolean;
  selectedSymbol: string | null;
  onSelect: (balance: TokenBalance) => void;
}

/** Truncate a formatted balance to a reasonable number of decimals */
function truncateBalance(formatted: string, decimals: number): string {
  const maxDecimals = decimals <= 6 ? 2 : 4;
  const parts = formatted.split('.');
  if (parts.length === 1) return formatted;
  return `${parts[0]}.${parts[1].slice(0, maxDecimals)}`;
}

export const TokenSelector: React.FC<TokenSelectorProps> = ({
  balances,
  isLoading,
  selectedSymbol,
  onSelect,
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={20} className="animate-spin text-theme-text-muted" />
        <span className="ml-2 text-theme-text-muted text-sm">Loading balances...</span>
      </div>
    );
  }

  if (balances.length === 0) {
    return (
      <div className="text-center py-4 text-theme-text-muted text-sm">
        No supported tokens found on this chain.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {balances.map((b) => {
        const isSelected = selectedSymbol === b.token.symbol;
        const hasBalance = b.balance > 0n;

        return (
          <button
            key={b.token.symbol}
            type="button"
            onClick={() => onSelect(b)}
            disabled={!hasBalance}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${
              isSelected
                ? 'bg-theme-surface-hover border-[#ff393a]/50'
                : hasBalance
                ? 'bg-theme-surface border-theme-stroke hover:bg-theme-surface-hover'
                : 'bg-theme-surface border-theme-stroke opacity-40 cursor-not-allowed'
            }`}
          >
            {/* Token icon (colored circle with symbol) */}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-theme-text shrink-0"
              style={{ backgroundColor: b.token.logoColor + '33', border: `1px solid ${b.token.logoColor}66` }}
            >
              {b.token.symbol.slice(0, 2)}
            </div>

            {/* Token info */}
            <div className="flex-1 text-left min-w-0">
              <div className="text-theme-text font-medium text-sm">{b.token.symbol}</div>
              <div className="text-theme-text-muted text-xs truncate">{b.token.name}</div>
            </div>

            {/* Balance */}
            <div className="text-right shrink-0">
              <div className="text-theme-text text-sm font-mono">
                {truncateBalance(b.formatted, b.token.decimals)}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};
