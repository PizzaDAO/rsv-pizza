import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Clock, MoreVertical, Pencil, Trash2, Receipt, FileText, User, RotateCcw } from 'lucide-react';
import { BudgetItem, BUDGET_CATEGORIES } from '../../types';

interface BudgetItemRowProps {
  item: BudgetItem;
  onToggleStatus: (itemId: string) => void;
  onEdit: (item: BudgetItem) => void;
  onDelete: (itemId: string) => void;
  // provolone-58931: super-admin-only restore of a soft-deleted item.
  onRestore?: (itemId: string) => void;
}

export const BudgetItemRow: React.FC<BudgetItemRowProps> = ({
  item,
  onToggleStatus,
  onEdit,
  onDelete,
  onRestore,
}) => {
  // provolone-58931: only super-admins ever receive soft-deleted items, so the
  // presence of deletedAt is sufficient to render the deleted-row UI.
  const isDeleted = Boolean(item.deletedAt);
  const { t } = useTranslation('host');
  const [showMenu, setShowMenu] = useState(false);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const isPdfUrl = (url: string) => {
    return /\.pdf(\?.*)?$/i.test(url);
  };

  const categoryInfo = BUDGET_CATEGORIES.find(c => c.id === item.category);

  return (
    <div className={`group flex items-center gap-3 p-3 bg-theme-surface hover:bg-theme-surface-hover border border-theme-stroke rounded-xl transition-colors ${
      isDeleted ? 'opacity-60 ring-1 ring-red-500/30' : ''
    }`}>
      {/* Status Toggle — hidden for soft-deleted rows (provolone-58931) */}
      {!isDeleted && (
        <button
          onClick={() => onToggleStatus(item.id)}
          className={`flex-shrink-0 p-1 rounded-full transition-colors ${
            item.status === 'paid'
              ? 'text-green-400 hover:text-green-300'
              : 'text-theme-text-faint hover:text-theme-text-muted'
          }`}
          title={item.status === 'paid' ? t('budget.markAsPending') : t('budget.markAsPaid')}
        >
          {item.status === 'paid' ? (
            <CheckCircle size={20} />
          ) : (
            <Clock size={20} />
          )}
        </button>
      )}

      {/* Item Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-sm font-medium truncate ${
            isDeleted ? 'text-theme-text-secondary line-through' :
            item.status === 'paid' ? 'text-theme-text-secondary line-through' : 'text-theme-text'
          }`}>
            {item.name}
          </p>
          {isDeleted && (
            <span className="flex-shrink-0 flex items-center gap-1 bg-red-600/90 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-full">
              <Trash2 size={10} />
              Deleted by host
            </span>
          )}
          {item.receiptUrl && (
            <a
              href={item.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 text-theme-text-muted hover:text-theme-text-secondary transition-colors"
              onClick={(e) => e.stopPropagation()}
              title={t('budget.viewReceiptTitle')}
            >
              {isPdfUrl(item.receiptUrl) ? (
                <FileText size={16} />
              ) : (
                <Receipt size={16} />
              )}
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-theme-text-muted">{categoryInfo?.label || item.category}</span>
          {item.pointPerson && (
            <>
              <span className="text-theme-text-faint">|</span>
              <span className="text-xs text-theme-text-muted flex items-center gap-1">
                <User size={10} />
                {item.pointPerson}
              </span>
            </>
          )}
        </div>
        {item.notes && (
          <p className="text-xs text-theme-text-faint mt-1 truncate">{item.notes}</p>
        )}
      </div>

      {/* Cost */}
      <div className={`text-right ${item.status === 'paid' ? 'text-theme-text-secondary' : 'text-theme-text'}`}>
        <p className="text-sm font-semibold">{formatCurrency(item.cost)}</p>
      </div>

      {/* provolone-58931: soft-deleted rows show a Restore button (super-admins
          only — only they receive deleted rows) instead of the actions menu. */}
      {isDeleted ? (
        onRestore && (
          <button
            onClick={() => onRestore(item.id)}
            className="flex-shrink-0 flex items-center gap-1 bg-green-600/90 hover:bg-green-600 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
            title="Restore item"
          >
            <RotateCcw size={14} />
            Restore
          </button>
        )
      ) : (
      /* Actions Menu */
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover transition-colors opacity-0 group-hover:opacity-100"
        >
          <MoreVertical size={16} />
        </button>

        {showMenu && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setShowMenu(false)}
            />
            <div className="absolute right-0 top-full mt-1 bg-theme-header border border-theme-stroke rounded-lg shadow-xl z-20 py-1 min-w-[120px]">
              <button
                onClick={() => {
                  setShowMenu(false);
                  onEdit(item);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-theme-text hover:bg-theme-surface-hover"
              >
                <Pencil size={14} />
                {t('budget.edit')}
              </button>
              <button
                onClick={() => {
                  setShowMenu(false);
                  onDelete(item.id);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-theme-surface-hover"
              >
                <Trash2 size={14} />
                {t('budget.delete')}
              </button>
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
};
