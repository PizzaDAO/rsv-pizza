import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import {
  BudgetOverview as BudgetOverviewType,
  BudgetItem,
  BudgetCategory,
  BudgetStatus,
  BUDGET_CATEGORIES,
} from '../../types';
import {
  getBudget,
  updateBudgetSettings,
  createBudgetItem,
  updateBudgetItem,
  deleteBudgetItem,
  toggleBudgetItemStatus,
} from '../../lib/api';
import { BudgetOverview } from './BudgetOverview';
import { BudgetCategorySection } from './BudgetCategorySection';
import { BudgetItemForm } from './BudgetItemForm';
import { BudgetSettings } from './BudgetSettings';

interface BudgetTabProps {
  partyId: string;
}

export const BudgetTab: React.FC<BudgetTabProps> = ({ partyId }) => {
  const [budget, setBudget] = useState<BudgetOverviewType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<BudgetItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const loadBudget = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await getBudget(partyId);
    if (data) {
      setBudget(data);
    } else {
      setError('Failed to load budget');
    }
    setLoading(false);
  }, [partyId]);

  useEffect(() => {
    loadBudget();
  }, [loadBudget]);

  const handleUpdateSettings = async (data: { budgetEnabled?: boolean; budgetTotal?: number | null }) => {
    const result = await updateBudgetSettings(partyId, data);
    if (result) {
      setBudget(prev => prev ? {
        ...prev,
        budgetEnabled: result.budgetEnabled,
        budgetTotal: result.budgetTotal,
        remaining: result.budgetTotal !== null ? result.budgetTotal - prev.totalSpent : null,
      } : null);
    }
  };

  const handleSaveItem = async (data: {
    name: string;
    category: BudgetCategory;
    cost: number;
    status?: BudgetStatus;
    pointPerson?: string;
    notes?: string;
    receiptUrl?: string;
  }) => {
    setSaving(true);
    try {
      if (editingItem) {
        // Update existing item
        const result = await updateBudgetItem(partyId, editingItem.id, data);
        if (result) {
          await loadBudget(); // Reload to get updated totals
          setShowForm(false);
          setEditingItem(null);
        }
      } else {
        // Create new item
        const result = await createBudgetItem(partyId, data);
        if (result) {
          await loadBudget(); // Reload to get updated totals
          setShowForm(false);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (itemId: string) => {
    const result = await toggleBudgetItemStatus(partyId, itemId);
    if (result) {
      await loadBudget(); // Reload to get updated totals
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    const success = await deleteBudgetItem(partyId, itemId);
    if (success) {
      await loadBudget(); // Reload to get updated totals
    }
    setShowDeleteConfirm(null);
  };

  const handleEdit = (item: BudgetItem) => {
    setEditingItem(item);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingItem(null);
  };

  // Group items by category
  const getItemsByCategory = (category: BudgetCategory) => {
    return budget?.items.filter(item => item.category === category) || [];
  };

  if (loading) {
    return (
      <div className="card p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <AlertCircle className="w-12 h-12 text-[#ff393a] mx-auto mb-4" />
        <p className="text-white/60 mb-4">{error}</p>
        <button
          onClick={loadBudget}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <RefreshCw size={16} />
          Try Again
        </button>
      </div>
    );
  }

  if (!budget) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Budget Overview Card */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Budget Overview</h2>
          <button
            onClick={() => setShowForm(true)}
            className="btn-primary inline-flex items-center gap-2 text-sm px-4 py-2"
          >
            <Plus size={16} />
            Add Expense
          </button>
        </div>

        <BudgetOverview
          budgetTotal={budget.budgetTotal}
          totalSpent={budget.totalSpent}
          totalPaid={budget.totalPaid}
          totalPending={budget.totalPending}
          remaining={budget.remaining}
        />
      </div>

      {/* Budget Settings */}
      <BudgetSettings
        budgetEnabled={budget.budgetEnabled}
        budgetTotal={budget.budgetTotal}
        onUpdate={handleUpdateSettings}
      />

      {/* Expenses by Category */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Expenses</h2>

        {budget.items.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-white/40 mb-4">No expenses recorded yet</p>
            <button
              onClick={() => setShowForm(true)}
              className="btn-secondary inline-flex items-center gap-2"
            >
              <Plus size={16} />
              Add Your First Expense
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {BUDGET_CATEGORIES.map((cat) => {
              const items = getItemsByCategory(cat.id);
              const totals = budget.categoryTotals[cat.id];
              if (items.length === 0) return null;
              return (
                <BudgetCategorySection
                  key={cat.id}
                  category={cat.id}
                  totals={totals}
                  items={items}
                  onToggleStatus={handleToggleStatus}
                  onEdit={handleEdit}
                  onDelete={(itemId) => setShowDeleteConfirm(itemId)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Form Modal */}
      {showForm && (
        <BudgetItemForm
          item={editingItem}
          onSave={handleSaveItem}
          onClose={handleCloseForm}
          saving={saving}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowDeleteConfirm(null)}>
          <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-white mb-3">Delete Expense?</h2>
            <p className="text-white/60 mb-6">
              This will permanently delete this expense item. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="flex-1 btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteItem(showDeleteConfirm)}
                className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium px-6 py-3 rounded-xl transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
