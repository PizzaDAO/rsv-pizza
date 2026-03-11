import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChecklistItem, AutoCompleteStates, ChecklistData } from '../../types';
import {
  getChecklist,
  seedChecklist,
  createChecklistItem,
  deleteChecklistItem,
  toggleChecklistItem,
} from '../../lib/api';
import { ChecklistItemRow } from './ChecklistItemRow';
import { ChecklistItemForm } from './ChecklistItemForm';

interface ChecklistTabProps {
  partyId: string;
}

function isItemCompleted(item: ChecklistItem, autoStates: AutoCompleteStates): boolean {
  if (item.isAuto && item.autoRule) {
    return autoStates[item.autoRule as keyof AutoCompleteStates] ?? false;
  }
  return item.completed;
}

export const ChecklistTab: React.FC<ChecklistTabProps> = ({ partyId }) => {
  const [data, setData] = useState<ChecklistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const navigate = useNavigate();
  const { inviteCode } = useParams<{ inviteCode: string }>();

  const loadChecklist = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getChecklist(partyId);
    if (result) {
      // If not yet seeded, seed defaults on first load
      if (!result.seeded) {
        const seedResult = await seedChecklist(partyId);
        if (seedResult) {
          // Re-fetch to get full data with auto-complete states
          const refreshed = await getChecklist(partyId);
          if (refreshed) {
            setData(refreshed);
          } else {
            setData(result);
          }
        } else {
          setData(result);
        }
      } else {
        setData(result);
      }
    } else {
      setError('Failed to load checklist');
    }
    setLoading(false);
  }, [partyId]);

  useEffect(() => {
    loadChecklist();
  }, [loadChecklist]);

  const handleToggle = async (itemId: string) => {
    const result = await toggleChecklistItem(partyId, itemId);
    if (result) {
      await loadChecklist();
    }
  };

  const handleCreateItem = async (itemData: { name: string; dueDate?: string | null }) => {
    setSaving(true);
    try {
      const result = await createChecklistItem(partyId, itemData);
      if (result) {
        await loadChecklist();
        setShowForm(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    const success = await deleteChecklistItem(partyId, itemId);
    if (success) {
      await loadChecklist();
    }
    setShowDeleteConfirm(null);
  };

  const handleNavigate = (tab: string) => {
    if (inviteCode) {
      if (tab === 'details') {
        navigate(`/host/${inviteCode}`);
      } else {
        navigate(`/host/${inviteCode}/${tab}`);
      }
    }
  };

  // Calculate progress
  const completedCount = data?.items.filter(item =>
    isItemCompleted(item, data.autoCompleteStates)
  ).length ?? 0;
  const totalCount = data?.items.length ?? 0;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

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
        <p className="text-theme-text-secondary mb-4">{error}</p>
        <button
          onClick={loadChecklist}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <RefreshCw size={16} />
          Try Again
        </button>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Progress Card */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-theme-text">Event Checklist</h2>
            <p className="text-xs text-theme-text-muted mt-0.5">
              {completedCount} of {totalCount} tasks complete
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="btn-primary inline-flex items-center gap-2 text-sm px-4 py-2"
          >
            <Plus size={16} />
            Add Task
          </button>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-theme-surface-hover rounded-full h-2.5">
          <div
            className="h-2.5 rounded-full transition-all duration-500"
            style={{
              width: `${progressPct}%`,
              backgroundColor: progressPct === 100 ? '#39d98a' : '#ff393a',
            }}
          />
        </div>
        <p className="text-right text-xs text-theme-text-muted mt-1">{progressPct}%</p>
      </div>

      {/* Items List */}
      <div className="card p-6">
        {data.items.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-theme-text-muted mb-4">No tasks yet</p>
            <button
              onClick={() => setShowForm(true)}
              className="btn-secondary inline-flex items-center gap-2"
            >
              <Plus size={16} />
              Add Your First Task
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {data.items.map((item) => (
              <ChecklistItemRow
                key={item.id}
                item={item}
                autoStates={data.autoCompleteStates}
                onToggle={handleToggle}
                onDelete={(id) => setShowDeleteConfirm(id)}
                onNavigate={handleNavigate}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add Form Modal */}
      {showForm && (
        <ChecklistItemForm
          onSave={handleCreateItem}
          onClose={() => setShowForm(false)}
          saving={saving}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowDeleteConfirm(null)}>
          <div className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-theme-text mb-3">Delete Task?</h2>
            <p className="text-theme-text-secondary mb-6">
              This will permanently delete this task. This action cannot be undone.
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
