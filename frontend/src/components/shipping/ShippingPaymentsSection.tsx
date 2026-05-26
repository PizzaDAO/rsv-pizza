import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Loader2, AlertCircle, RefreshCw, Receipt as ReceiptIcon, BadgeDollarSign } from 'lucide-react';
import { fetchMyShippingPayouts } from '../../lib/api';
import type { ShippingKit, ShippingPayout, PayoutMethod, PayoutStatus } from '../../types';
import { NewShippingReceiptModal } from './NewShippingReceiptModal';

interface ShippingPaymentsSectionProps {
  /**
   * Kits the coordinator can attach receipts to. Filtered upstream by region
   * so the dropdown only shows kits they actually handle.
   */
  kits: ShippingKit[];
}

const METHOD_LABEL: Record<PayoutMethod, string> = {
  mercury_card: 'Mercury card',
  wire: 'Wire transfer',
  usdc_base: 'USDC on Base',
};

const STATUS_STYLES: Record<PayoutStatus, string> = {
  pending: 'bg-amber-500/20 text-amber-800',
  approved: 'bg-sky-500/20 text-sky-800',
  rejected: 'bg-red-500/20 text-red-800',
  paid: 'bg-emerald-500/20 text-emerald-800',
  failed: 'bg-red-600/30 text-red-900',
};

const STATUS_LABEL: Record<PayoutStatus, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Paid',
  failed: 'Failed',
};

/**
 * salumi-89172: "My Payments" section on the /shipping dashboard.
 *
 * Shows the current coordinator's submitted shipping receipts and provides
 * a "+ New shipping receipt" CTA that opens NewShippingReceiptModal. Reuses
 * the host PayoutListRow visual treatment but inline so the dashboard's
 * GPP theme reads cleanly against the light background.
 */
export const ShippingPaymentsSection: React.FC<ShippingPaymentsSectionProps> = ({ kits }) => {
  const [payouts, setPayouts] = useState<ShippingPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyShippingPayouts();
      setPayouts(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load your payments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreated = (created: ShippingPayout) => {
    setPayouts((prev) => [created, ...prev]);
    setShowModal(false);
  };

  const totalPaidUsd = payouts
    .filter((p) => p.status === 'paid')
    .reduce((s, p) => s + Number(p.finalAmountUsd || 0), 0);

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-theme-text inline-flex items-center gap-2">
            <ReceiptIcon size={18} />
            My Payments
          </h2>
          <p className="text-xs text-theme-text-muted mt-0.5">
            Submit receipts for shipping costs you've paid (postage, packing, supplies).
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-xl font-medium text-sm transition-colors"
        >
          <Plus size={16} />
          New shipping receipt
        </button>
      </div>

      {loading ? (
        <div className="bg-white/60 border border-theme-stroke rounded-xl p-8 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
        </div>
      ) : error ? (
        <div className="bg-white/60 border border-theme-stroke rounded-xl p-6 text-center">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-theme-text-secondary mb-3">{error}</p>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text"
          >
            <RefreshCw size={14} />
            Try again
          </button>
        </div>
      ) : payouts.length === 0 ? (
        <div className="bg-white/60 border border-theme-stroke rounded-xl p-8 text-center">
          <ReceiptIcon className="w-10 h-10 text-theme-text-muted mx-auto mb-2" />
          <p className="text-sm font-medium text-theme-text mb-1">No receipts yet</p>
          <p className="text-xs text-theme-text-muted">
            Submit your first shipping receipt to get reimbursed.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {totalPaidUsd > 0 && (
            <div className="bg-white/60 border border-theme-stroke rounded-xl p-3 sm:p-4 flex items-center gap-3">
              <BadgeDollarSign size={18} className="text-emerald-600 flex-shrink-0" />
              <div className="text-sm font-medium text-theme-text">
                Total paid to date: ${totalPaidUsd.toFixed(2)}
              </div>
            </div>
          )}
          <div className="bg-white/60 border border-theme-stroke rounded-xl p-3 sm:p-4 space-y-2">
            {payouts.map((p) => (
              <ShippingPayoutRow key={p.id} payout={p} />
            ))}
          </div>
        </div>
      )}

      {showModal && (
        <NewShippingReceiptModal
          kits={kits}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </section>
  );
};

interface ShippingPayoutRowProps {
  payout: ShippingPayout;
}

const ShippingPayoutRow: React.FC<ShippingPayoutRowProps> = ({ payout }) => {
  const kit = payout.partyKit;
  const party = payout.party;

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-white hover:bg-white/80 transition-colors border border-theme-stroke">
      {/* Amount + tied-to */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-theme-text font-semibold">
          <span>${Number(payout.finalAmountUsd).toFixed(2)} USD</span>
          {payout.originalCurrency && payout.originalCurrency !== 'USD' && (
            <span className="text-xs text-theme-text-muted font-normal">
              ({Number(payout.originalAmount).toLocaleString()} {payout.originalCurrency})
            </span>
          )}
        </div>
        <div className="text-xs text-theme-text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {party && (
            <span className="truncate max-w-[200px]" title={party.name}>
              {party.name}
            </span>
          )}
          {kit && (
            <>
              <span aria-hidden>•</span>
              <span>
                Kit → {kit.recipientName}, {kit.city}
              </span>
            </>
          )}
          <span aria-hidden>•</span>
          <span>{payout.payoutMethod ? METHOD_LABEL[payout.payoutMethod] : 'No method set'}</span>
          <span aria-hidden>•</span>
          <span>
            {new Date(payout.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        </div>
      </div>

      {/* Status pill */}
      <span
        className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLES[payout.status]}`}
      >
        {STATUS_LABEL[payout.status]}
      </span>
    </div>
  );
};
