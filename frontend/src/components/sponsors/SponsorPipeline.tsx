import React, { useState } from 'react';
import { Edit2, Target, Check } from 'lucide-react';
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
  invoiced: { label: 'Invoiced', color: 'text-yellow-400', bgColor: 'bg-yellow-500' },
  paid: { label: 'Paid', color: 'text-blue-400', bgColor: 'bg-blue-500' },
  stuck: { label: 'Stuck', color: 'text-red-400', bgColor: 'bg-red-500' },
  alum: { label: 'Alum', color: 'text-purple-400', bgColor: 'bg-purple-500' },
  skip: { label: 'Skip', color: 'text-gray-500', bgColor: 'bg-gray-700' },
};

// Main pipeline flow
const PIPELINE_STATUSES: SponsorStatus[] = ['todo', 'asked', 'yes', 'invoiced', 'paid'];
// Secondary statuses
const SECONDARY_STATUSES: SponsorStatus[] = ['stuck', 'skip', 'alum'];

export function SponsorPipeline({ stats, onUpdateGoal, isLoading }: SponsorPipelineProps) {
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const goal = stats?.fundraisingGoal || 0;
  const received = stats?.totalReceived || 0;
  const confirmed = stats?.totalConfirmed || 0;
  const progressPercent = goal > 0 ? Math.min((received / goal) * 100, 100) : 0;
  const confirmedPercent = goal > 0 ? Math.min((confirmed / goal) * 100, 100) : 0;

  const handleEditGoal = () => {
    setGoalInput(goal > 0 ? goal.toString() : '');
    setIsEditingGoal(true);
  };

  const handleSaveGoal = async () => {
    setIsSaving(true);
    try {
      const newGoal = goalInput ? parseFloat(goalInput) : null;
      await onUpdateGoal(newGoal);
      setIsEditingGoal(false);
    } catch (error) {
      console.error('Failed to update goal:', error);
    }
    setIsSaving(false);
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
    <div className="card p-4 bg-[#1a1a2e] border-white/10">
      {/* Fundraising Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Target size={18} className="text-[#ff393a]" />
            <span className="text-sm font-medium text-white">Fundraising</span>
          </div>
          {isEditingGoal ? (
            <div className="flex items-center gap-2">
              <span className="text-white/60 text-sm">$</span>
              <input
                type="number"
                value={goalInput}
                onChange={e => setGoalInput(e.target.value)}
                placeholder="Goal amount"
                className="w-24 bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                autoFocus
              />
              <button
                onClick={handleSaveGoal}
                disabled={isSaving}
                className="p-1 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded transition-colors"
              >
                <Check size={16} />
              </button>
              <button
                onClick={() => setIsEditingGoal(false)}
                className="text-white/40 hover:text-white/60 text-sm"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={handleEditGoal}
              className="flex items-center gap-1 text-white/60 hover:text-white text-sm transition-colors"
            >
              {goal > 0 ? formatCurrency(goal) : 'Set Goal'}
              <Edit2 size={14} />
            </button>
          )}
        </div>

        {/* Progress Bar */}
        <div className="relative h-4 bg-white/10 rounded-full overflow-hidden mb-2">
          {/* Confirmed amount (lighter) */}
          {confirmedPercent > 0 && (
            <div
              className="absolute inset-y-0 left-0 bg-green-500/30 transition-all duration-500"
              style={{ width: `${confirmedPercent}%` }}
            />
          )}
          {/* Received amount (solid) */}
          <div
            className="absolute inset-y-0 left-0 bg-blue-500 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-white/60">Received: {formatCurrency(received)}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500/50" />
              <span className="text-white/60">Confirmed: {formatCurrency(confirmed)}</span>
            </span>
          </div>
          {goal > 0 && (
            <span className="text-white/40">
              {Math.round(progressPercent)}% of goal
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
                  <span className="text-[10px] text-white/40">{config.label}</span>
                </div>
                {index < PIPELINE_STATUSES.length - 1 && (
                  <span className="text-white/20 text-lg">→</span>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Secondary statuses */}
        <div className="flex items-center justify-center gap-6 pt-2 border-t border-white/5">
          {SECONDARY_STATUSES.map(status => {
            const config = STATUS_CONFIG[status];
            const count = stats?.statusCounts[status] || 0;
            return (
              <div key={status} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${config.bgColor}`} />
                <span className="text-xs text-white/40">{config.label}</span>
                <span className={`text-xs font-medium ${config.color}`}>({count})</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
