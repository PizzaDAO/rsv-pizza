import React, { useEffect, useState } from 'react';
import { Loader2, X, ChevronRight, CreditCard, Banknote, Coins, HelpCircle, ImageOff } from 'lucide-react';
import { Payout, PayoutMethod, PayoutStatus } from '../../types';
import { cancelPayout, fetchAdminMe } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

interface PayoutListRowProps {
  payout: Payout;
  partyId: string;
  onOpen: () => void;
  onCancelled: (payoutId: string) => void;
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
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Paid',
  failed: 'Failed',
};

// arugula-38633 v3 follow-up: helper to display a method (or "Not set" placeholder).
export function methodLabel(method: PayoutMethod | null): string {
  return method == null ? 'Not set' : METHOD_LABEL[method];
}

export function methodIcon(method: PayoutMethod | null): React.ReactNode {
  switch (method) {
    case 'mercury_card': return <CreditCard size={14} />;
    case 'wire':         return <Banknote size={14} />;
    case 'usdc_base':    return <Coins size={14} />;
    default:             return <HelpCircle size={14} />;
  }
}

export const PayoutListRow: React.FC<PayoutListRowProps> = ({
  payout,
  partyId,
  onOpen,
  onCancelled,
}) => {
  const { user } = useAuth();
  const [cancelling, setCancelling] = useState(false);

  // gouda-83912: only the submitter (or any admin) may cancel a payout from
  // the host-side list. Other cohosts can still see and open the row, but
  // the inline X button is hidden so they don't get a 403 on click.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchAdminMe()
      .then(r => { if (!cancelled) setIsAdmin(Boolean(r?.isAdmin)); })
      .catch(() => { /* unauth or non-admin — leave false */ });
    return () => { cancelled = true; };
  }, []);
  const canModify =
    isAdmin || (user?.id != null && user.id === payout.hostUserId);

  // First pizza photo, or first receipt as a fallback thumbnail
  const thumb = payout.documents.find(d => d.kind === 'pizza')
    ?? payout.documents.find(d => d.kind === 'receipt');

  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Cancel this payment request? This cannot be undone.')) return;
    setCancelling(true);
    try {
      const ok = await cancelPayout(partyId, payout.id);
      if (ok) {
        onCancelled(payout.id);
      }
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div
      onClick={onOpen}
      className="flex items-center gap-3 p-3 rounded-xl bg-theme-surface-hover hover:bg-theme-surface-active cursor-pointer transition-colors"
    >
      {/* Thumbnail */}
      <div className="w-14 h-14 rounded-lg overflow-hidden bg-theme-surface flex-shrink-0">
        {thumb ? (
          <img src={thumb.url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-theme-text-muted">
            <ImageOff size={20} />
          </div>
        )}
      </div>

      {/* Center column: amount + method */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-theme-text font-semibold">
          <span>${payout.finalAmountUsd.toFixed(2)} USD</span>
          {payout.originalCurrency && payout.originalCurrency !== 'USD' && (
            <span className="text-xs text-theme-text-muted font-normal">
              ({payout.originalAmount.toLocaleString()} {payout.originalCurrency})
            </span>
          )}
        </div>
        <div className="text-xs text-theme-text-muted flex items-center gap-2 mt-0.5">
          <span className="inline-flex items-center gap-1">
            {methodIcon(payout.payoutMethod)}
            {methodLabel(payout.payoutMethod)}
          </span>
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

      {/* Cancel button (only while pending, and only for the submitter/admin) */}
      {payout.status === 'pending' && canModify && (
        <button
          onClick={handleCancel}
          disabled={cancelling}
          className="p-1.5 rounded-md text-theme-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          title="Cancel"
        >
          {cancelling ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
        </button>
      )}

      <ChevronRight size={16} className="text-theme-text-muted flex-shrink-0" />
    </div>
  );
};
