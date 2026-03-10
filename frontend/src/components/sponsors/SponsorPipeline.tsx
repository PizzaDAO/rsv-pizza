import React, { useState, useEffect, useRef } from 'react';
import { Edit2, Target, Check, Loader2 } from 'lucide-react';
import { SponsorStats, SponsorStatus } from '../../types';

interface SponsorPipelineProps {
  stats: SponsorStats | null;
  onUpdateGoal: (goal: number | null) => Promise<void>;
  isLoading?: boolean;
}

const STATUS_CONFIG: Record<SponsorStatus, { label: string; color: string; bgColor: string }> = {
  todo: { label: 'To Do', color: 'text-gray-400', bgColor: 'bg-gray-500' },
  asked: { label: 'Asked', color: 'text-orange-400', bgColor: 'bg-orange-500' },
  yes: { label: 'Yes', color: 'text-green-400', bgColor: 'bg-green-500' },
  billed: { label: 'Billed', color: 'text-yellow-400', bgColor: 'bg-yellow-500' },
  paid: { label: 'Paid', color: 'text-blue-400', bgColor: 'bg-blue-500' },
  stuck: { label: 'Stuck', color: 'text-red-400', bgColor: 'bg-red-500' },
  alum: { label: 'Alum', color: 'text-purple-400', bgColor: 'bg-purple-500' },
  skip: { label: 'Skip', color: 'text-gray-500', bgColor: 'bg-gray-700' },
};

// Main pipeline flow
const PIPELINE_STATUSES: SponsorStatus[] = ['todo', 'asked', 'yes', 'billed', 'paid'];
// Secondary statuses
const SECONDARY_STATUSES: SponsorStatus[] = ['stuck', 'skip', 'alum'];

export function SponsorPipeline({ stats, onUpdateGoal, isLoading }: SponsorPipelineProps) {
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const goal = stats?.fundraisingGoal || 0;
  const confirmed = stats?.totalConfirmed || 0;
  const progressPercent = goal > 0 ? Math.min((confirmed / goal) * 100, 100) : 0;

  // Initialize goalInput when editing starts
  useEffect(() => {
    if (isEditingGoal) {
      setGoalInput(goal > 0 ? goal.toString() : '');
    }
  }, [isEditingGoal, goal]);

  // Auto-save with debounce
  const handleGoalChange = (value: string) => {
    setGoalInput(value);

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout for auto-save
    saveTimeoutRef.current = setTimeout(async () => {
      const newGoal = value ? parseFloat(value) : null;
      // Only save if the value has actually changed
      if (newGoal !== goal) {
        setIsSaving(true);
        try {
          await onUpdateGoal(newGoal);
        } catch (error) {
          console.error('Failed to update goal:', error);
        }
        setIsSaving(false);
      }
    }, 800); // 800ms debounce
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleEditGoal = () => {
    setIsEditingGoal(true);
    // Focus input after render
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSaveGoal = () => {
    // Save immediately if there's a pending change
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    const newGoal = goalInput ? parseFloat(goalInput) : null;
    if (newGoal !== goal) {
      setIsSaving(true);
      onUpdateGoal(newGoal).finally(() => setIsSaving(false));
    }
    setIsEditingGoal(false);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="card p-4 bg-theme-header border-theme-stroke">
      {/* Fundraising Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Target size={18} className="text-[#ff393a]" />
            <span className="text-sm font-medium text-theme-text">Fundraising</span>
          </div>
          {isEditingGoal ? (
            <div className="flex items-center gap-2">
              <span className="text-theme-text-secondary text-sm">$</span>
              <input
                ref={inputRef}
                type="number"
                value={goalInput}
                onChange={e => handleGoalChange(e.target.value)}
                onBlur={handleSaveGoal}
                onKeyDown={e => e.key === 'Enter' && handleSaveGoal()}
                placeholder="Goal amount"
                className="w-24 bg-theme-surface-hover border border-theme-stroke-hover rounded px-2 py-1 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
              />
              {isSaving ? (
                <Loader2 size={16} className="animate-spin text-theme-text-muted" />
              ) : (
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={handleSaveGoal}
                  className="flex items-center gap-1 px-2 py-1 bg-[#ff393a] hover:bg-[#ff393a]/80 text-white text-xs rounded transition-colors"
                >
                  <Check size={14} />
                  Set
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={handleEditGoal}
              className="flex items-center gap-1 text-theme-text-secondary hover:text-theme-text text-sm transition-colors"
            >
              {goal > 0 ? formatCurrency(goal) : 'Set Goal'}
              <Edit2 size={14} />
            </button>
          )}
        </div>

        {/* Progress Bar */}
        <div className="relative h-4 bg-theme-surface-hover rounded-full overflow-hidden mb-2">
          <div
            className="absolute inset-y-0 left-0 bg-green-500 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-theme-text-secondary">
            {formatCurrency(confirmed)}{goal > 0 ? ` of ${formatCurrency(goal)}` : ''}
          </span>
          {goal > 0 && (
            <span className="text-theme-text-muted">
              {Math.round(progressPercent)}%
            </span>
          )}
        </div>
      </div>

      {/* Pipeline Status Counts */}
      <div className="space-y-3">
        {/* Main pipeline flow */}
        <div className="flex items-center justify-between gap-1">
          {PIPELINE_STATUSES.map((status, index) => {
            const config = STATUS_CONFIG[status];
            const count = stats?.statusCounts[status] || 0;
            return (
              <React.Fragment key={status}>
                <div className="flex flex-col items-center">
                  <span className={`text-lg font-bold ${config.color}`}>{count}</span>
                  <span className="text-[10px] text-theme-text-muted">{config.label}</span>
                </div>
                {index < PIPELINE_STATUSES.length - 1 && (
                  <span className="text-theme-text-faint text-lg">→</span>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Secondary statuses */}
        <div className="flex items-center justify-center gap-6 pt-2 border-t border-theme-stroke">
          {SECONDARY_STATUSES.map(status => {
            const config = STATUS_CONFIG[status];
            const count = stats?.statusCounts[status] || 0;
            return (
              <div key={status} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${config.bgColor}`} />
                <span className="text-xs text-theme-text-muted">{config.label}</span>
                <span className={`text-xs font-medium ${config.color}`}>({count})</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
