import React from 'react';
import { DollarSign, Calendar, TrendingUp, Inbox } from 'lucide-react';
import type { AdminPayoutTotals } from '../../types';
import { formatUsd } from '../payments-shared';

interface PaymentsStatsCardsProps {
  totals: AdminPayoutTotals | null;
  loading?: boolean;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'amber' | 'emerald';
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, tone = 'default' }) => {
  const toneClass =
    tone === 'amber' ? 'border-amber-300 bg-amber-50' :
    tone === 'emerald' ? 'border-emerald-300 bg-emerald-50' :
    'border-theme-stroke bg-theme-surface';
  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-theme-text-muted mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-xl font-semibold text-theme-text">{value}</div>
    </div>
  );
};

export const PaymentsStatsCards: React.FC<PaymentsStatsCardsProps> = ({ totals, loading }) => {
  if (loading || !totals) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-theme-stroke bg-theme-surface p-4 animate-pulse h-20" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <StatCard
        icon={<DollarSign size={14} />}
        label="Pending"
        value={formatUsd(totals.totalUsdPending)}
        tone="amber"
      />
      <StatCard
        icon={<Calendar size={14} />}
        label="Paid this month"
        value={formatUsd(totals.totalUsdThisMonth)}
        tone="emerald"
      />
      <StatCard
        icon={<TrendingUp size={14} />}
        label="Avg payout"
        value={formatUsd(totals.avgUsd)}
      />
      <StatCard
        icon={<Inbox size={14} />}
        label="Awaiting review"
        value={String(totals.awaitingReview)}
      />
    </div>
  );
};
