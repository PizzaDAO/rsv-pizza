import React from 'react';
import { DollarSign } from 'lucide-react';

interface BudgetData {
  total: number;
  spent: number;
  paid: number;
  pending: number;
  remaining: number | null;
}

interface BudgetSummaryProps {
  budget: BudgetData;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export const BudgetSummary: React.FC<BudgetSummaryProps> = ({ budget }) => {
  const percentage = budget.total > 0 ? Math.min(100, Math.round((budget.spent / budget.total) * 100)) : 0;

  return (
    <div>
      {/* Progress bar */}
      {budget.total > 0 && (
        <div className="flex items-center gap-3 mb-3">
          <DollarSign size={14} className="text-theme-text-muted flex-shrink-0" />
          <div className="flex-1 h-2 bg-theme-surface rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${percentage}%`,
                backgroundColor: percentage > 90 ? '#ef4444' : percentage > 70 ? '#f59e0b' : '#22c55e',
              }}
            />
          </div>
          <span className="text-xs text-theme-text-secondary whitespace-nowrap">
            {percentage}%
          </span>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {budget.total > 0 && (
          <div className="bg-theme-surface rounded-lg px-3 py-2">
            <div className="text-xs text-theme-text-muted">Budget</div>
            <div className="text-sm font-medium text-theme-text">{formatCurrency(budget.total)}</div>
          </div>
        )}
        <div className="bg-theme-surface rounded-lg px-3 py-2">
          <div className="text-xs text-theme-text-muted">Spent</div>
          <div className="text-sm font-medium text-theme-text">{formatCurrency(budget.spent)}</div>
        </div>
        <div className="bg-theme-surface rounded-lg px-3 py-2">
          <div className="text-xs text-theme-text-muted">Paid</div>
          <div className="text-sm font-medium text-green-600">{formatCurrency(budget.paid)}</div>
        </div>
        {budget.remaining !== null && (
          <div className="bg-theme-surface rounded-lg px-3 py-2">
            <div className="text-xs text-theme-text-muted">Remaining</div>
            <div className={`text-sm font-medium ${budget.remaining >= 0 ? 'text-theme-text' : 'text-red-500'}`}>
              {formatCurrency(budget.remaining)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
