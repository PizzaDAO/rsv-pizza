import React from 'react';
import { DollarSign, TrendingUp, Clock, CheckCircle } from 'lucide-react';

interface BudgetOverviewProps {
  budgetTotal: number | null;
  totalSpent: number;
  totalPaid: number;
  totalPending: number;
  remaining: number | null;
}

export const BudgetOverview: React.FC<BudgetOverviewProps> = ({
  budgetTotal,
  totalSpent,
  totalPaid,
  totalPending,
  remaining,
}) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  // Calculate percentage spent
  const percentSpent = budgetTotal && budgetTotal > 0
    ? Math.min(100, (totalSpent / budgetTotal) * 100)
    : 0;

  // Determine color based on spending
  const getProgressColor = () => {
    if (!budgetTotal) return 'bg-white/20';
    if (percentSpent >= 100) return 'bg-red-500';
    if (percentSpent >= 80) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="space-y-4">
      {/* Budget Progress Bar (only if budget is set) */}
      {budgetTotal !== null && budgetTotal > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-white/80">Budget Progress</span>
            <span className="text-sm font-medium text-white">
              {formatCurrency(totalSpent)} / {formatCurrency(budgetTotal)}
            </span>
          </div>
          <div className="h-3 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full ${getProgressColor()} transition-all duration-300`}
              style={{ width: `${percentSpent}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs text-white/50">{percentSpent.toFixed(0)}% used</span>
            {remaining !== null && (
              <span className={`text-xs ${remaining >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {remaining >= 0 ? `${formatCurrency(remaining)} remaining` : `${formatCurrency(Math.abs(remaining))} over budget`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Total Spent */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={16} className="text-[#ff393a]" />
            <span className="text-xs font-medium text-white/60">Total Spent</span>
          </div>
          <p className="text-xl font-bold text-white">{formatCurrency(totalSpent)}</p>
        </div>

        {/* Budget Total or Remaining */}
        {budgetTotal !== null && budgetTotal > 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={16} className="text-green-400" />
              <span className="text-xs font-medium text-white/60">Remaining</span>
            </div>
            <p className={`text-xl font-bold ${remaining !== null && remaining >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {remaining !== null ? formatCurrency(remaining) : '--'}
            </p>
          </div>
        ) : (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={16} className="text-white/40" />
              <span className="text-xs font-medium text-white/60">Budget</span>
            </div>
            <p className="text-sm text-white/40">Not set</p>
          </div>
        )}

        {/* Paid */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={16} className="text-green-400" />
            <span className="text-xs font-medium text-white/60">Paid</span>
          </div>
          <p className="text-xl font-bold text-white">{formatCurrency(totalPaid)}</p>
        </div>

        {/* Pending */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={16} className="text-yellow-400" />
            <span className="text-xs font-medium text-white/60">Pending</span>
          </div>
          <p className="text-xl font-bold text-white">{formatCurrency(totalPending)}</p>
        </div>
      </div>
    </div>
  );
};
