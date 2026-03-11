import React, { useState, useEffect } from 'react';
import { DollarSign, Users, Target, Loader2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { usePizza } from '../contexts/PizzaContext';
import { getDonations } from '../lib/api';
import { Donation } from '../types';
import { getExplorerTxUrl, getChainName } from '../lib/tokens';

export const DonationSummary: React.FC = () => {
  const { party } = usePizza();
  const [loading, setLoading] = useState(true);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [summary, setSummary] = useState<{ totalAmount: number; totalCount: number; currency: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    async function fetchDonations() {
      if (!party?.id || !party.donationEnabled) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const result = await getDonations(party.id);
      if (result) {
        setDonations(result.donations);
        setSummary(result.summary);
      }
      setLoading(false);
    }

    fetchDonations();
  }, [party?.id, party?.donationEnabled]);

  if (!party?.donationEnabled) {
    return null;
  }

  if (loading) {
    return (
      <div className="card p-6 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  const formatAmount = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const goalProgress = party.donationGoal && summary
    ? Math.min((summary.totalAmount / (party.donationGoal * 100)) * 100, 100)
    : null;

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-theme-text flex items-center gap-2">
          <DollarSign size={20} className="text-[#ff393a]" />
          Donations
        </h3>
        {donations.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-theme-text-secondary hover:text-theme-text flex items-center gap-1 text-sm"
          >
            {expanded ? 'Hide' : 'Show'} Details
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-theme-surface rounded-xl p-4 border border-theme-stroke">
          <div className="flex items-center gap-2 text-theme-text-secondary text-sm mb-1">
            <DollarSign size={14} />
            Total Raised
          </div>
          <div className="text-2xl font-bold text-[#39d98a]">
            {summary ? formatAmount(summary.totalAmount) : '$0.00'}
          </div>
        </div>
        <div className="bg-theme-surface rounded-xl p-4 border border-theme-stroke">
          <div className="flex items-center gap-2 text-theme-text-secondary text-sm mb-1">
            <Users size={14} />
            Donors
          </div>
          <div className="text-2xl font-bold text-theme-text">
            {summary?.totalCount || 0}
          </div>
        </div>
      </div>

      {/* Goal Progress */}
      {party.donationGoal && goalProgress !== null && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-theme-text-secondary flex items-center gap-1">
              <Target size={14} />
              Goal Progress
            </span>
            <span className="text-theme-text font-medium">
              {summary ? formatAmount(summary.totalAmount) : '$0'} / ${party.donationGoal}
            </span>
          </div>
          <div className="h-3 bg-theme-surface-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#ff393a] to-[#ff6b6b] transition-all duration-500"
              style={{ width: `${goalProgress}%` }}
            />
          </div>
          <div className="text-right text-xs text-theme-text-muted mt-1">
            {goalProgress.toFixed(0)}% of goal
          </div>
        </div>
      )}

      {/* Donations List */}
      {expanded && donations.length > 0 && (
        <div className="border-t border-theme-stroke pt-4 mt-4">
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {donations.map((donation) => (
              <div
                key={donation.id}
                className="flex items-center justify-between p-3 bg-theme-surface rounded-xl border border-theme-stroke"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-theme-text font-medium truncate">
                      {donation.isAnonymous ? 'Anonymous' : donation.donorName || 'Guest'}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      donation.status === 'succeeded'
                        ? 'bg-[#39d98a]/20 text-[#39d98a]'
                        : donation.status === 'pending'
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-[#ff393a]/20 text-[#ff393a]'
                    }`}>
                      {donation.status}
                    </span>
                    {donation.paymentMethod === 'crypto' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#627eea]/20 text-[#627eea]">
                        {donation.tokenSymbol || 'crypto'}
                        {donation.chainId ? ` (${getChainName(donation.chainId)})` : ''}
                      </span>
                    )}
                  </div>
                  {donation.message && (
                    <p className="text-theme-text-muted text-sm truncate mt-0.5">"{donation.message}"</p>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-theme-text-muted text-xs">
                      {formatDate(donation.createdAt)}
                    </p>
                    {donation.txHash && donation.chainId && (
                      <a
                        href={getExplorerTxUrl(donation.chainId, donation.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[#627eea] hover:text-[#627eea]/80 text-xs transition-colors"
                      >
                        <ExternalLink size={10} />
                        tx
                      </a>
                    )}
                  </div>
                </div>
                <div className="text-lg font-bold text-[#39d98a] ml-4">
                  {donation.paymentMethod === 'crypto'
                    ? `${Number(donation.amount)} ${donation.tokenSymbol || ''}`
                    : formatAmount(Number(donation.amount))
                  }
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {donations.length === 0 && (
        <div className="text-center py-6 text-theme-text-muted">
          <DollarSign size={32} className="mx-auto mb-2 opacity-50" />
          <p>No donations yet</p>
          <p className="text-sm">Share your event link to start receiving donations</p>
        </div>
      )}
    </div>
  );
};
