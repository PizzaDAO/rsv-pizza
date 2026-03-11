import React from 'react';
import { Performer, PerformerType } from '../../types';
import { DollarSign, Check, Clock } from 'lucide-react';

interface LineupOverviewProps {
  performers: Performer[];
}

// Type icons with emoji
const typeIcons: Record<PerformerType, string> = {
  dj: '\uD83C\uDFA7',
  live_band: '\uD83C\uDFB8',
  solo: '\uD83C\uDFA4',
  playlist: '\uD83C\uDFB5',
};

// Format time for display
function formatTime(time: string | null): string {
  if (!time) return '';
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

// Format fee
function formatFee(fee: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(fee);
}

export const LineupOverview: React.FC<LineupOverviewProps> = ({ performers }) => {
  // Filter to only confirmed performers for the overview
  const activePerformers = performers.filter((p) => p.status !== 'cancelled');

  // Calculate totals
  const totalBudget = performers.reduce((sum, p) => sum + (p.fee || 0), 0);
  const totalPaid = performers.reduce((sum, p) => sum + (p.feePaid ? p.fee || 0 : 0), 0);

  // Sort by set time if available
  const sortedPerformers = [...activePerformers].sort((a, b) => {
    if (!a.setTime && !b.setTime) return a.sortOrder - b.sortOrder;
    if (!a.setTime) return 1;
    if (!b.setTime) return -1;
    return a.setTime.localeCompare(b.setTime);
  });

  if (sortedPerformers.length === 0) {
    return null;
  }

  return (
    <div className="bg-theme-surface border border-theme-stroke rounded-xl p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">{'\uD83C\uDFB5'}</span>
        <h3 className="text-theme-text font-medium">Music Lineup</h3>
      </div>

      {/* Timeline */}
      <div className="space-y-2 mb-4">
        {sortedPerformers.map((performer) => (
          <div
            key={performer.id}
            className={`flex items-center gap-3 p-2 rounded-lg ${
              performer.status === 'pending' ? 'opacity-60' : ''
            }`}
          >
            {/* Time */}
            <div className="w-20 flex-shrink-0">
              {performer.setTime ? (
                <span className="text-sm text-theme-text-secondary">{formatTime(performer.setTime)}</span>
              ) : (
                <span className="text-sm text-theme-text-muted flex items-center gap-1">
                  <Clock size={12} />
                  TBD
                </span>
              )}
            </div>

            {/* Type Icon */}
            <span className="text-lg flex-shrink-0">{typeIcons[performer.type]}</span>

            {/* Name */}
            <span className="text-theme-text flex-1 truncate">{performer.name}</span>

            {/* Genre */}
            {performer.genre && (
              <span className="text-sm text-theme-text-muted hidden sm:block">({performer.genre})</span>
            )}
          </div>
        ))}
      </div>

      {/* Budget Summary */}
      {totalBudget > 0 && (
        <div className="flex items-center justify-between pt-3 border-t border-theme-stroke">
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1 text-theme-text-secondary">
              <DollarSign size={14} className="text-theme-text-muted" />
              <span>Budget: {formatFee(totalBudget)}</span>
            </div>
            <div className="flex items-center gap-1 text-green-400">
              <Check size={14} />
              <span>Paid: {formatFee(totalPaid)}</span>
            </div>
          </div>
          {totalBudget > totalPaid && (
            <div className="text-sm text-yellow-400">
              Remaining: {formatFee(totalBudget - totalPaid)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
