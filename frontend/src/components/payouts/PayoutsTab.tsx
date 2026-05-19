import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, AlertCircle, RefreshCw, ArrowLeft, Lock } from 'lucide-react';
import { Payout } from '../../types';
import { listPayouts, fetchUnderbossMe, fetchAdminMe } from '../../lib/api';
import { PayoutsList } from './PayoutsList';
import { NewPayoutForm } from './NewPayoutForm';
import { PayoutDetailModal } from './PayoutDetailModal';

interface PayoutsTabProps {
  partyId: string;
  reimbursementCapUsd?: number | null;
  reimbursementCapAppealNote?: string | null;
  reimbursementCapAppealedAt?: string | null;
  /** Threaded to NewPayoutForm — gates the "ask once" attendance prompt. */
  expectedGuests?: number | null;
}

type View = 'list' | 'new';

/**
 * Container for the host-side Payouts tab.
 * Routes between the list view and the "new payout" form, and renders a
 * detail modal for past payouts.
 *
 * Soft-launch gate (arugula-38633 v1): only underbosses + admins see the
 * full UI; everyone else sees a "coming soon" placeholder. Backend enforces
 * the same restriction. Remove `canAccess` checks here when opening up.
 */
export const PayoutsTab: React.FC<PayoutsTabProps> = ({
  partyId,
  reimbursementCapUsd,
  reimbursementCapAppealNote,
  reimbursementCapAppealedAt,
  expectedGuests,
}) => {
  const [view, setView] = useState<View>('list');
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailPayoutId, setDetailPayoutId] = useState<string | null>(null);
  const [canAccess, setCanAccess] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ub, ad] = await Promise.all([
          fetchUnderbossMe().catch(() => null),
          fetchAdminMe().catch(() => null),
        ]);
        if (cancelled) return;
        const eligible = Boolean(ub?.isUnderboss) || Boolean(ad?.isAdmin);
        setCanAccess(eligible);
      } catch {
        if (!cancelled) setCanAccess(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadPayouts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPayouts(partyId);
      setPayouts(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load payouts');
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => {
    if (canAccess) loadPayouts();
  }, [loadPayouts, canAccess]);

  if (canAccess === null) {
    return (
      <div className="card p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  if (canAccess === false) {
    return (
      <div className="card p-8 text-center max-w-lg mx-auto">
        <Lock className="w-10 h-10 text-white/40 mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">Payouts — Coming Soon</h3>
        <p className="text-sm text-white/60">
          Host reimbursements are currently in soft launch for underbosses and admins.
          We'll open it up to all hosts soon — stay tuned.
        </p>
      </div>
    );
  }

  const handleCreated = (created: Payout) => {
    // Optimistic update: prepend to list, then close the form.
    setPayouts(prev => [created, ...prev]);
    setView('list');
  };

  const handleCancelled = (payoutId: string) => {
    setPayouts(prev => prev.filter(p => p.id !== payoutId));
  };

  if (loading) {
    return (
      <div className="card p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <AlertCircle className="w-12 h-12 text-[#ff393a] mx-auto mb-4" />
        <p className="text-theme-text-secondary mb-4">{error}</p>
        <button
          onClick={loadPayouts}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <RefreshCw size={16} />
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {view === 'list' && (
        <>
          <div className="card p-6">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-lg font-semibold text-theme-text">Reimbursements</h2>
                <p className="text-sm text-theme-text-secondary mt-1">
                  Upload receipts for out-of-pocket expenses and choose how you want to get paid back.
                </p>
              </div>
              <button
                onClick={() => setView('new')}
                className="btn-primary inline-flex items-center gap-2 text-sm px-4 py-2 whitespace-nowrap"
              >
                <Plus size={16} />
                New payout
              </button>
            </div>
          </div>

          <PayoutsList
            payouts={payouts}
            onOpenDetail={id => setDetailPayoutId(id)}
            onCancelled={handleCancelled}
            onStartNew={() => setView('new')}
            partyId={partyId}
          />
        </>
      )}

      {view === 'new' && (
        <>
          <button
            onClick={() => setView('list')}
            className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text transition-colors"
          >
            <ArrowLeft size={16} />
            Back to payouts
          </button>
          <NewPayoutForm
            partyId={partyId}
            onCreated={handleCreated}
            onCancel={() => setView('list')}
            reimbursementCapUsd={reimbursementCapUsd}
            reimbursementCapAppealNote={reimbursementCapAppealNote}
            reimbursementCapAppealedAt={reimbursementCapAppealedAt}
            expectedGuests={expectedGuests}
          />
        </>
      )}

      {detailPayoutId && (
        <PayoutDetailModal
          partyId={partyId}
          payoutId={detailPayoutId}
          onClose={() => setDetailPayoutId(null)}
        />
      )}
    </div>
  );
};
