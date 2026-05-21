import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Loader2, AlertCircle } from 'lucide-react';
import { fetchUserPaymentDetails, type UserPaymentDetails } from '../../lib/api';
import { PayoutMethodIcon, PAYOUT_METHOD_LABELS } from '../payments-shared';
import { ClickableEmail } from '../ClickableEmail';

interface HostPaymentDetailsModalProps {
  /**
   * The User.id whose saved payment-details we should display. When `null`
   * the modal does not render — parent owns the open/closed state.
   */
  userId: string | null;
  onClose: () => void;
}

/**
 * siciliana-69183: read-only modal opened when an admin clicks a host name on
 * the /payments dashboard (prepay queue chips OR payouts-table "Submitted by"
 * captions). Fetches the host's saved payment details on mount and renders
 * method, wallet (with copy), bank email (with copy), plus a small activity
 * blurb. Does NOT mount until `userId` is set — keeps the parent free of any
 * pre-load.
 */
export const HostPaymentDetailsModal: React.FC<HostPaymentDetailsModalProps> = ({
  userId,
  onClose,
}) => {
  const [data, setData] = useState<UserPaymentDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    if (!userId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [userId, onClose]);

  // Fetch when userId is set (and re-fetch when it changes).
  useEffect(() => {
    if (!userId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetchUserPaymentDetails(userId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Failed to load payment details');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId) return null;

  const body = (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto bg-theme-surface border border-theme-stroke rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-theme-text truncate">
              {data?.name || (loading ? 'Loading…' : 'Host payment details')}
            </h2>
            {data?.email && (
              <div className="text-xs text-theme-text-muted mt-0.5 flex items-center gap-1.5">
                <ClickableEmail email={data.email} />
                <CopyButton value={data.email} label="email" />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-theme-surface-hover text-theme-text-muted shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-10 text-theme-text-muted">
            <Loader2 size={20} className="animate-spin mr-2" />
            Loading payment details…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {data && !loading && !error && (
          <div className="space-y-4">
            {/* Method row */}
            <div>
              <p className="text-xs uppercase tracking-wide text-theme-text-muted mb-1.5">
                Preferred method
              </p>
              {data.preferredPayoutMethod ? (
                <div className="flex items-center gap-2 text-sm text-theme-text">
                  <PayoutMethodIcon method={data.preferredPayoutMethod} size={16} />
                  <span>{PAYOUT_METHOD_LABELS[data.preferredPayoutMethod]}</span>
                </div>
              ) : (
                <div className="text-sm text-theme-text-muted italic">
                  No payment method on file
                </div>
              )}
            </div>

            {/* Method-specific body */}
            {data.preferredPayoutMethod === 'usdc_base' && (
              <div>
                <p className="text-xs uppercase tracking-wide text-theme-text-muted mb-1.5">
                  Wallet address
                </p>
                {data.payoutWalletAddress ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-theme-surface-hover border border-theme-stroke">
                    <code className="text-xs text-theme-text break-all flex-1">
                      {data.payoutWalletAddress}
                    </code>
                    <CopyButton value={data.payoutWalletAddress} label="address" />
                  </div>
                ) : (
                  <div className="text-sm text-theme-text-muted italic">
                    Wallet not set
                  </div>
                )}
              </div>
            )}

            {data.preferredPayoutMethod === 'wire' && (
              <div>
                <p className="text-xs uppercase tracking-wide text-theme-text-muted mb-1.5">
                  Bank correspondence email
                </p>
                {data.payoutBankDetails?.email ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-theme-surface-hover border border-theme-stroke">
                    <span className="text-sm text-theme-text break-all flex-1">
                      {data.payoutBankDetails.email}
                    </span>
                    <CopyButton value={data.payoutBankDetails.email} label="email" />
                  </div>
                ) : (
                  <div className="text-sm text-theme-text-muted italic">
                    No bank email on file
                  </div>
                )}
                <p className="text-xs text-theme-text-muted mt-1.5">
                  Routing / account details are intentionally not shown here — collect them
                  out-of-band over the bank email.
                </p>
              </div>
            )}

            {data.preferredPayoutMethod === 'mercury_card' && (
              <div className="text-sm text-theme-text-muted">
                Card is emailed by Mercury — no recipient details to display.
              </div>
            )}

            {/* Activity blurb */}
            <div className="pt-3 border-t border-theme-stroke">
              <p className="text-xs text-theme-text-muted">
                {data.totalPayouts} payout{data.totalPayouts === 1 ? '' : 's'}
                {data.latestPayoutAt
                  ? ` • latest ${new Date(data.latestPayoutAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}`
                  : ' • no payouts yet'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(body, document.body);
};

/** Inline copy-to-clipboard button with a 1.5s "copied!" flash. */
const CopyButton: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard unavailable — silently no-op.
        }
      }}
      className="p-1 rounded-md text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover shrink-0"
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
    >
      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
    </button>
  );
};
