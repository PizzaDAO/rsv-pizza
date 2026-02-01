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
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <h3 className="text-sm font-medium text-white/80 mb-3">Budget Settings</h3>

      <div className="space-y-3">
        {/* Budget Total */}
        <div>
          <label className="block text-xs text-white/60 mb-1">Total Budget</label>
          <div className="relative">
            <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="number"
              step="0.01"
              min="0"
              value={localBudgetTotal}
              onChange={(e) => setLocalBudgetTotal(e.target.value)}
              onBlur={handleBudgetTotalBlur}
              placeholder="0.00"
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            />
            {saving && (
              <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 animate-spin" />
            )}
          </div>
          <p className="text-xs text-white/40 mt-1">Leave empty for no budget limit</p>
        </div>
      </div>
    </div>
  );
};
