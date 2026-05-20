import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Loader2, AlertCircle, RefreshCw, ArrowLeft, Lock, Info, BadgeDollarSign } from 'lucide-react';
import { Payout } from '../../types';
import { listPayouts, fetchUnderbossMe, fetchAdminMe } from '../../lib/api';
import { usePizza } from '../../contexts/PizzaContext';
import { parsePartyKitCapFromTags } from '../../lib/reimbursementCap';
import { PayoutsList } from './PayoutsList';
import { NewPayoutForm } from './NewPayoutForm';
import { PayoutDetailModal } from './PayoutDetailModal';
import { ExpectedGuestsCard } from './ExpectedGuestsCard';
import { PrepayCheckbox } from './PrepayCheckbox';

interface PayoutsTabProps {
  partyId: string;
  /**
   * Raw underboss-validated cap (DB column). Used for the appeal flow only —
   * host-visible cap display should use `effectiveReimbursementCapUsd`.
   */
  reimbursementCapUsd?: number | null;
  /**
   * arugula-38633 v2 follow-up: effective cap after numeric-tag fallback.
   * Precedence: reimbursementCapUsd → max(numeric event_tags) → null.
   * Host-visible UI (banner, stat header, null-cap notice) reads THIS.
   */
  effectiveReimbursementCapUsd?: number | null;
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
  effectiveReimbursementCapUsd,
  reimbursementCapAppealNote,
  reimbursementCapAppealedAt,
  expectedGuests,
}) => {
  const { party } = usePizza();
  const partyKitCapUsd = parsePartyKitCapFromTags(party?.eventTags);
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
        // arugula-38633 v3: host is eligible if the party has BOTH an
        // effective reimbursement cap AND the 'go' event_tag (the explicit
        // "open this event to the host" signal, settable only by admin /
        // payment_admin / super_admin via PATCH /api/parties/:id). Backend
        // enforces the same gate per-handler.
        const hasCap =
          typeof effectiveReimbursementCapUsd === 'number' &&
          effectiveReimbursementCapUsd > 0;
        const hasGo = Array.isArray(party?.eventTags) && party!.eventTags.includes('go');
        const eligible =
          Boolean(ub?.isUnderboss) || Boolean(ad?.isAdmin) || (hasCap && hasGo);
        setCanAccess(eligible);
      } catch {
        if (!cancelled) setCanAccess(false);
      }
    })();
    return () => { cancelled = true; };
  }, [effectiveReimbursementCapUsd]);

  const loadPayouts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPayouts(partyId);
      setPayouts(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => {
    if (canAccess) loadPayouts();
  }, [loadPayouts, canAccess]);

  // arugula-38633 v2 follow-up: sum already-paid payouts so the host can see
  // their running reimbursement total. MUST be declared before any conditional
  // returns below — moving it after would break rules-of-hooks (hook count
  // changes when canAccess flips null/false → true). Was the source of a hard
  // React crash that black-screened the page.
  const totalPaidUsd = useMemo(
    () => payouts
      .filter(p => p.status === 'paid')
      .reduce((s, p) => s + Number(p.finalAmountUsd || 0), 0),
    [payouts]
  );

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
        <h3 className="text-lg font-semibold mb-2">Payments — Coming Soon</h3>
        <p className="text-sm text-white/60">
          Host payments are currently in soft launch for underbosses and admins.
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
      {/*
        arugula-38633 v2 follow-up: always-visible expected-guests editor.
        Lives above the view-switch so it appears in BOTH the list and new-
        payment views — it's an event-level setting, not per-form. Reads/
        writes the same `parties.expected_guests` field used by EventForm,
        PartyHeader, /underboss EventRow, and NewPayoutForm's first-time
        prompt — single source of truth.
      */}
      {/* Cap banner (arugula-38633 v2): always visible at the top of the
          Payments section. When the underboss has set a cap (or a numeric
          event_tag fallback exists), shows the value. When neither exists,
          shows the prompt to set expected_guests + contact underboss. */}
      {typeof effectiveReimbursementCapUsd === 'number' && effectiveReimbursementCapUsd > 0 ? (
        <div className="card p-4 sm:p-5 border-l-4 border-l-emerald-500 flex items-start gap-3">
          <BadgeDollarSign size={20} className="text-emerald-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm font-medium text-theme-text">
            We'll reimburse you for up to ${effectiveReimbursementCapUsd.toFixed(2)}
            {partyKitCapUsd != null && (
              <> of pizza and up to ${partyKitCapUsd.toFixed(2)} of party kit expenses</>
            )}
            .
          </div>
        </div>
      ) : (
        <div className="card p-4 sm:p-5 border-l-4 border-l-amber-500 flex items-start gap-3">
          <Info size={20} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm font-medium text-theme-text">
            No cap set. Set your expected guests and contact your underboss.
          </div>
        </div>
      )}

      <PrepayCheckbox partyId={partyId} />

      <ExpectedGuestsCard partyId={partyId} expectedGuests={expectedGuests} />

      {view === 'list' && (
        <>
          <div className="card p-6">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-lg font-semibold text-theme-text">Payments</h2>
                <p className="text-sm text-theme-text-secondary mt-1">
                  Upload receipts for expenses and choose how you want to get paid back.
                </p>
              </div>
              <button
                onClick={() => setView('new')}
                className="btn-primary inline-flex items-center gap-2 text-sm px-4 py-2 whitespace-nowrap"
              >
                <Plus size={16} />
                New payment
              </button>
            </div>
          </div>

          <PayoutsList
            payouts={payouts}
            onOpenDetail={id => setDetailPayoutId(id)}
            onCancelled={handleCancelled}
            onStartNew={() => setView('new')}
            partyId={partyId}
            totalPaidUsd={totalPaidUsd}
            reimbursementCapUsd={effectiveReimbursementCapUsd ?? null}
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
            Back to payments
          </button>
          <NewPayoutForm
            partyId={partyId}
            onCreated={handleCreated}
            onCancel={() => setView('list')}
            reimbursementCapUsd={effectiveReimbursementCapUsd}
            reimbursementCapAppealNote={reimbursementCapAppealNote}
            reimbursementCapAppealedAt={reimbursementCapAppealedAt}
            totalPaidUsd={totalPaidUsd}
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
