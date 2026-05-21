import React, { useCallback, useEffect, useState } from 'react';
import { Wallet, RefreshCcw, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { fetchPayoutWalletInfo, type PayoutWalletInfo } from '../../lib/api';

/**
 * coppa-91827: payout hot wallet info card.
 *
 * Self-fetches the wallet address + live ETH (gas) and USDC balances from
 * `/api/admin/payout-wallet/info` on mount. Renders at the top of /payments
 * (above PaymentsStatsCards) so admins know where to deposit funds and can
 * verify deposits landed without leaving the dashboard.
 *
 * Visual states:
 *  - Loading  → skeleton placeholders for the address + balance rows.
 *  - Error    → amber-bordered alert with the backend message plus a
 *               configuration hint when the wallet env var is unset.
 *  - Ready    → address (full, monospaced) with a copy-to-clipboard button
 *               and two balance tiles. ETH amount turns amber when below
 *               LOW_GAS_THRESHOLD_ETH so admins notice they need to top up
 *               gas before USDC payouts can be sent.
 */

// Below this threshold the ETH balance renders amber as a low-gas warning.
// 0.005 ETH at Base mainnet gas prices comfortably covers many ERC-20
// transfers, so dipping under it is the right "top me up" signal.
const LOW_GAS_THRESHOLD_ETH = 0.005;

/** Trim trailing zeros from a decimal string but keep at least 2 decimals. */
function formatBalance(raw: string, decimals: number): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  // Show full precision for very small numbers so 0.0001 doesn't round to 0.00.
  if (n > 0 && n < 0.01) {
    return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
  }
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

export const HotWalletCard: React.FC = () => {
  const [info, setInfo] = useState<PayoutWalletInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await fetchPayoutWalletInfo();
      setInfo(data);
    } catch (err: any) {
      setInfo(null);
      setErrorMsg(err?.message || 'Failed to load hot wallet info');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCopy = useCallback(async () => {
    if (!info?.address) return;
    try {
      await navigator.clipboard.writeText(info.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — silently no-op (matches HostPaymentDetailsModal).
    }
  }, [info?.address]);

  // Detect the "wallet not configured" 503 so we can surface a more pointed
  // remediation hint (the backend already includes the env-var name, but we
  // also want a styled callout that doesn't blend into a generic error).
  const isUnconfigured = !!errorMsg && /USDC_PAYOUT_WALLET_PRIVATE_KEY/i.test(errorMsg);

  const ethNum = info ? Number(info.ethBalance) : 0;
  const lowGas = info != null && Number.isFinite(ethNum) && ethNum < LOW_GAS_THRESHOLD_ETH;

  return (
    <section className="card p-4 sm:p-5 mb-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
          <Wallet size={18} className="text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-theme-text">Hot wallet (Base)</h2>
          <p className="text-xs text-theme-text-muted">
            Self-custodied payout wallet — funds outgoing USDC payments.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="p-2 rounded-md text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover disabled:opacity-50"
          title="Refresh balances"
          aria-label="Refresh balances"
        >
          {loading
            ? <Loader2 size={14} className="animate-spin" />
            : <RefreshCcw size={14} />}
        </button>
      </div>

      {errorMsg ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-200">
            <div className="font-medium">Hot wallet unavailable</div>
            <div className="text-amber-200/80 mt-0.5 break-words">{errorMsg}</div>
            {isUnconfigured && (
              <div className="text-xs text-amber-200/70 mt-1">
                Set <span className="font-mono">USDC_PAYOUT_WALLET_PRIVATE_KEY</span> on backend Vercel
                and redeploy.
              </div>
            )}
          </div>
        </div>
      ) : loading && !info ? (
        <div className="space-y-3">
          <div className="h-8 rounded-md bg-theme-surface-hover animate-pulse" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-16 rounded-md bg-theme-surface-hover animate-pulse" />
            <div className="h-16 rounded-md bg-theme-surface-hover animate-pulse" />
          </div>
        </div>
      ) : info ? (
        <>
          <div className="flex items-center gap-2 rounded-md border border-theme-stroke bg-theme-surface px-3 py-2 mb-3">
            <span className="font-mono text-sm text-theme-text break-all flex-1 min-w-0">
              {info.address}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="p-1 rounded-md text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover shrink-0"
              title="Copy address"
              aria-label="Copy address"
            >
              {copied
                ? <Check size={14} className="text-emerald-500" />
                : <Copy size={14} />}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border border-theme-stroke bg-theme-surface p-3">
              <div className="text-xs uppercase tracking-wide text-theme-text-secondary mb-1">
                ETH for gas
              </div>
              <div
                className={`text-lg font-semibold ${lowGas ? 'text-amber-300' : 'text-theme-text'}`}
                title={`${info.ethBalanceWei} wei`}
              >
                {formatBalance(info.ethBalance, 6)}
              </div>
              {lowGas && (
                <div className="text-[11px] text-amber-300/80 mt-1">
                  Below {LOW_GAS_THRESHOLD_ETH} ETH — top up to avoid stalled payouts.
                </div>
              )}
            </div>
            <div className="rounded-md border border-theme-stroke bg-theme-surface p-3">
              <div className="text-xs uppercase tracking-wide text-theme-text-secondary mb-1">
                USDC
              </div>
              <div
                className="text-lg font-semibold text-theme-text"
                title={`${info.usdcBalanceUnits} base units`}
              >
                {formatBalance(info.usdcBalance, 6)}
              </div>
            </div>
          </div>

          <div className="text-xs text-theme-text-muted mt-3">
            Send only ETH (gas) and USDC on Base (chainId {info.chainId}) — other tokens/chains will be lost.
          </div>
        </>
      ) : null}
    </section>
  );
};
