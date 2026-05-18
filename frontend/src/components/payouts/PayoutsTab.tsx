import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import { Payout } from '../../types';
import { listPayouts } from '../../lib/api';
import { PayoutsList } from './PayoutsList';
import { NewPayoutForm } from './NewPayoutForm';
import { PayoutDetailModal } from './PayoutDetailModal';

interface PayoutsTabProps {
  partyId: string;
}

type View = 'list' | 'new';

/**
 * Container for the host-side Payouts tab.
 * Routes between the list view and the "new payout" form, and renders a
 * detail modal for past payouts.
 */
export const PayoutsTab: React.FC<PayoutsTabProps> = ({ partyId }) => {
  const [view, setView] = useState<View>('list');
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailPayoutId, setDetailPayoutId] = useState<string | null>(null);

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
    loadPayouts();
  }, [loadPayouts]);

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
