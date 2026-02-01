import React, { useState } from 'react';
import { CheckCircle, Clock, MoreVertical, Pencil, Trash2, ExternalLink, User } from 'lucide-react';
import { BudgetItem, BUDGET_CATEGORIES } from '../../types';

interface BudgetItemRowProps {
  item: BudgetItem;
  onToggleStatus: (itemId: string) => void;
  onEdit: (item: BudgetItem) => void;
  onDelete: (itemId: string) => void;
}

export const BudgetItemRow: React.FC<BudgetItemRowProps> = ({
  item,
  onToggleStatus,
  onEdit,
  onDelete,
}) => {
  const [showMenu, setShowMenu] = useState(false);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const categoryInfo = BUDGET_CATEGORIES.find(c => c.id === item.category);

  return (
    <div className="group flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors">
      {/* Status Toggle */}
      <button
        onClick={() => onToggleStatus(item.id)}
        className={`flex-shrink-0 p-1 rounded-full transition-colors ${
          item.status === 'paid'
            ? 'text-green-400 hover:text-green-300'
            : 'text-white/30 hover:text-white/50'
        }`}
        title={item.status === 'paid' ? 'Mark as pending' : 'Mark as paid'}
      >
        {item.status === 'paid' ? (
          <CheckCircle size={20} />
        ) : (
          <Clock size={20} />
        )}
      </button>

      {/* Item Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-sm font-medium truncate ${
            item.status === 'paid' ? 'text-white/60 line-through' : 'text-white'
          }`}>
            {item.name}
          </p>
          {item.receiptUrl && (
            <a
              href={item.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/40 hover:text-white/60"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-white/40">{categoryInfo?.label || item.category}</span>
          {item.pointPerson && (
            <>
              <span className="text-white/20">|</span>
              <span className="text-xs text-white/40 flex items-center gap-1">
                <User size={10} />
                {item.pointPerson}
              </span>
            </>
          )}
        </div>
        {item.notes && (
          <p className="text-xs text-white/30 mt-1 truncate">{item.notes}</p>
        )}
      </div>

      {/* Cost */}
      <div className={`text-right ${item.status === 'paid' ? 'text-white/60' : 'text-white'}`}>
        <p className="text-sm font-semibold">{formatCurrency(item.cost)}</p>
      </div>

      {/* Actions Menu */}
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
        >
          <MoreVertical size={16} />
        </button>

        {showMenu && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setShowMenu(false)}
            />
            <div className="absolute right-0 top-full mt-1 bg-[#1a1a2e] border border-white/10 rounded-lg shadow-xl z-20 py-1 min-w-[120px]">
              <button
                onClick={() => {
                  setShowMenu(false);
                  onEdit(item);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
              >
                <Pencil size={14} />
                Edit
              </button>
              <button
                onClick={() => {
                  setShowMenu(false);
                  onDelete(item.id);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-white/10"
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
