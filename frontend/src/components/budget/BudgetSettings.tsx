import React, { useState, useEffect } from 'react';
import { DollarSign, Loader2 } from 'lucide-react';

interface BudgetSettingsProps {
  budgetEnabled: boolean;
  budgetTotal: number | null;
  onUpdate: (data: { budgetEnabled?: boolean; budgetTotal?: number | null }) => Promise<void>;
}

export const BudgetSettings: React.FC<BudgetSettingsProps> = ({
  budgetEnabled,
  budgetTotal,
  onUpdate,
}) => {
  const [localBudgetTotal, setLocalBudgetTotal] = useState(budgetTotal?.toString() || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocalBudgetTotal(budgetTotal?.toString() || '');
  }, [budgetTotal]);

  const handleBudgetTotalBlur = async () => {
    const newValue = localBudgetTotal ? parseFloat(localBudgetTotal) : null;
    if (newValue !== budgetTotal) {
      setSaving(true);
      await onUpdate({ budgetTotal: newValue });
      setSaving(false);
    }
  };

  return (
    <div className="bg-theme-surface border border-theme-stroke rounded-xl p-4">
      <h3 className="text-sm font-medium text-theme-text mb-3">Budget Settings</h3>

      <div className="space-y-3">
        {/* Budget Total */}
        <div>
          <label className="block text-xs text-theme-text-secondary mb-1">Total Budget</label>
          <div className="relative">
            <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
            <input
              type="number"
              step="0.01"
              min="0"
              value={localBudgetTotal}
              onChange={(e) => setLocalBudgetTotal(e.target.value)}
              onBlur={handleBudgetTotalBlur}
              placeholder="0.00"
              className="w-full bg-theme-surface border border-theme-stroke rounded-lg pl-9 pr-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            />
            {saving && (
              <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted animate-spin" />
            )}
          </div>
          <p className="text-xs text-theme-text-muted mt-1">Leave empty for no budget limit</p>
        </div>
      </div>
    </div>
  );
};
