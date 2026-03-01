import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Pizza, Wine, Home, Package, Music, Heart, MoreHorizontal } from 'lucide-react';
import { BudgetItem, BudgetCategory, BudgetCategoryTotal, BUDGET_CATEGORIES } from '../../types';
import { BudgetItemRow } from './BudgetItemRow';

interface BudgetCategorySectionProps {
  category: BudgetCategory;
  totals: BudgetCategoryTotal;
  items: BudgetItem[];
  onToggleStatus: (itemId: string) => void;
  onEdit: (item: BudgetItem) => void;
  onDelete: (itemId: string) => void;
}

const categoryIcons: Record<BudgetCategory, React.ComponentType<{ size?: number; className?: string }>> = {
  pizza: Pizza,
  drinks: Wine,
  venue: Home,
  supplies: Package,
  entertainment: Music,
  tips: Heart,
  other: MoreHorizontal,
};

export const BudgetCategorySection: React.FC<BudgetCategorySectionProps> = ({
  category,
  totals,
  items,
  onToggleStatus,
  onEdit,
  onDelete,
}) => {
  const [isExpanded, setIsExpanded] = useState(items.length > 0);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const categoryInfo = BUDGET_CATEGORIES.find(c => c.id === category);
  const Icon = categoryIcons[category] || MoreHorizontal;

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      {/* Category Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown size={18} className="text-white/40" />
          ) : (
            <ChevronRight size={18} className="text-white/40" />
          )}
          <Icon size={18} className="text-[#ff393a]" />
          <span className="font-medium text-white">{categoryInfo?.label || category}</span>
          <span className="text-xs text-white/40 bg-white/10 px-2 py-0.5 rounded-full">
            {totals.count} item{totals.count !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-white">{formatCurrency(totals.total)}</p>
          {totals.pending > 0 && (
            <p className="text-xs text-yellow-400">{formatCurrency(totals.pending)} pending</p>
          )}
        </div>
      </button>

      {/* Items */}
      {isExpanded && (
        <div className="p-2 space-y-2">
          {items.map((item) => (
            <BudgetItemRow
              key={item.id}
              item={item}
              onToggleStatus={onToggleStatus}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
};
