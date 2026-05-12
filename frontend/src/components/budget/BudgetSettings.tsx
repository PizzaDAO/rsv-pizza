import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign, Loader2 } from 'lucide-react';
import { IconInput } from '../IconInput';

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
  const { t } = useTranslation('host');
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
    <div className="card p-4">
      <h3 className="text-sm font-medium text-theme-text mb-3">{t('budget.budgetSettings')}</h3>

      <div className="space-y-3">
        {/* Budget Total */}
        <div>
          <div className="relative">
            <IconInput
              icon={DollarSign}
              type="number"
              step="0.01"
              min="0"
              value={localBudgetTotal}
              onChange={(e) => setLocalBudgetTotal(e.target.value)}
              onBlur={handleBudgetTotalBlur}
              placeholder={t('budget.totalBudgetPlaceholder')}
            />
            {saving && (
              <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted animate-spin" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
