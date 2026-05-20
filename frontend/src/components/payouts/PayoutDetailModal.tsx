import React, { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { Payout, PayoutStatus, PayoutMethod } from '../../types';
import { getPayout } from '../../lib/api';
import { methodIcon } from './PayoutListRow';

interface PayoutDetailModalProps {
  partyId: string;
  payoutId: string;
  onClose: () => void;
}

const METHOD_LABEL: Record<PayoutMethod, string> = {
  mercury_card: 'Mercury card',
  wire: 'Wire transfer',
  usdc_base: 'USDC on Base',
};

const STATUS_STYLES: Record<PayoutStatus, string> = {
  pending: 'bg-amber-500/20 text-amber-300',
  approved: 'bg-sky-500/20 text-sky-300',
  rejected: 'bg-red-500/20 text-red-300',
  paid: 'bg-emerald-500/20 text-emerald-300',
  failed: 'bg-red-600/30 text-red-200',
};

const STATUS_LABEL: Record<PayoutStatus, string> = {
  pending: 'Pending review',
  approved: 'Approved — payment pending',
  rejected: 'Rejected',
  paid: 'Paid',
  failed: 'Failed',
};

/**
 * Read-only detail view for a single payout. Click outside or X to close.
 */
export const PayoutDetailModal: React.FC<PayoutDetailModalProps> = ({
  partyId,
  payoutId,
  onClose,
}) => {
  const [payout, setPayout] = useState<Payout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPayout(partyId, payoutId)
      .then(p => { if (!cancelled) setPayout(p); })
      .catch(err => { if (!cancelled) setError(err?.message || 'Failed to load payment'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [partyId, payoutId]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-theme-stroke">
          <div>
            <h2 className="text-lg font-semibold text-theme-text">Payment details</h2>
            {payout && (
              <p className="text-xs text-theme-text-muted mt-0.5">
                Submitted {new Date(payout.createdAt).toLocaleString()}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {loading && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300 inline-flex items-center gap-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          {payout && (
            <>
              {/* Status + amount */}
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <p className="text-xs text-theme-text-muted">Amount</p>
                  <p className="text-2xl font-bold text-theme-text">
                    ${payout.finalAmountUsd.toFixed(2)} <span className="text-sm font-normal text-theme-text-muted">USD</span>
                  </p>
                  {payout.originalCurrency !== 'USD' && (
                    <p className="text-xs text-theme-text-muted">
                      from {payout.originalAmount.toLocaleString()} {payout.originalCurrency}
                      {' '}@ {payout.exchangeRate.toFixed(6)} (locked at submission)
                    </p>
                  )}
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLES[payout.status]}`}>
                  {STATUS_LABEL[payout.status]}
                </span>
              </div>

              {/* Payout method */}
              <div className="rounded-lg bg-theme-surface-hover p-3 text-sm">
                <p className="text-xs text-theme-text-muted mb-1">Payment method</p>
                <p className="inline-flex items-center gap-2 text-theme-text font-medium">
                  {methodIcon(payout.payoutMethod)}
                  {METHOD_LABEL[payout.payoutMethod]}
                </p>
                {payout.payoutMethod === 'usdc_base' && payout.payoutWalletAddress && (
                  <p className="text-xs text-theme-text-muted font-mono mt-1">
                    {payout.payoutWalletAddress}
                  </p>
                )}
                {payout.payoutMethod === 'wire' && payout.payoutBankDetails && (
                  <p className="text-xs text-theme-text-muted mt-1">
                    {payout.payoutBankDetails.accountHolderName} • {payout.payoutBankDetails.bankName}
                  </p>
                )}
                {payout.payoutMethod === 'mercury_card' && payout.mercuryCardLast4 && (
                  <p className="text-xs text-theme-text-muted mt-1">
                    Card ending •••• {payout.mercuryCardLast4}
                  </p>
                )}
              </div>

              {/* Notes */}
              {payout.hostNotes && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-1">Your notes</p>
                  <p className="text-sm text-theme-text whitespace-pre-wrap">{payout.hostNotes}</p>
                </div>
              )}
              {payout.adminNotes && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-1">Reviewer notes</p>
                  <p className="text-sm text-theme-text whitespace-pre-wrap">{payout.adminNotes}</p>
                </div>
              )}
              {payout.rejectionReason && (
                <div>
                  <p className="text-xs text-red-300 mb-1">Rejection reason</p>
                  <p className="text-sm text-theme-text whitespace-pre-wrap">{payout.rejectionReason}</p>
                </div>
              )}

              {/* Receipts (with OCR breakdown) */}
              {payout.documents.some(d => d.kind === 'receipt') && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-2">Receipts</p>
                  <ul className="space-y-2">
                    {payout.documents.filter(d => d.kind === 'receipt').map(d => (
                      <li key={d.id} className="flex items-center gap-3 p-2 rounded-lg bg-theme-surface-hover">
                        <a href={d.url} target="_blank" rel="noreferrer" className="flex-shrink-0">
                          <img src={d.url} alt="" className="w-14 h-14 rounded object-cover" />
                        </a>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-theme-text truncate">{d.fileName}</p>
                          {d.ocrAmount != null ? (
                            <p className="text-xs text-theme-text-muted">
                              ${d.ocrAmount.toFixed(2)} USD
                              {d.ocrCurrency && d.ocrCurrency !== 'USD' && ` (from ${d.ocrCurrency})`}
                              {d.ocrConfidence != null && ` • ${Math.round(d.ocrConfidence * 100)}% confidence`}
                            </p>
                          ) : d.ocrError ? (
                            <p className="text-xs text-amber-300">OCR failed: {d.ocrError}</p>
                          ) : null}
                        </div>
                        <a href={d.url} target="_blank" rel="noreferrer" className="p-1 text-theme-text-muted hover:text-theme-text">
                          <ExternalLink size={14} />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Pizza photos */}
              {payout.documents.some(d => d.kind === 'pizza') && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-2">Pizza / event photos</p>
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                    {payout.documents.filter(d => d.kind === 'pizza').map(d => (
                      <a
                        key={d.id}
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="aspect-square rounded-lg overflow-hidden bg-theme-surface"
                      >
                        <img src={d.url} alt="" className="w-full h-full object-cover hover:opacity-90 transition-opacity" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Receipts of payment */}
              {payout.status === 'paid' && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                  {payout.transactionHash && (
                    <p className="text-theme-text">
                      Paid via USDC on Base —{' '}
                      <a
                        href={`https://basescan.org/tx/${payout.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-300 hover:underline inline-flex items-center gap-1"
                      >
                        view on Basescan <ExternalLink size={12} />
                      </a>
                    </p>
                  )}
                  {payout.wireReference && (
                    <p className="text-theme-text">
                      Wire reference: <span className="font-mono">{payout.wireReference}</span>
                    </p>
                  )}
                  {payout.mercuryCardLast4 && (
                    <p className="text-theme-text">
                      Your Mercury card ending in •••• {payout.mercuryCardLast4} has been issued.
                      Check the email Mercury sent you for full card details.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
