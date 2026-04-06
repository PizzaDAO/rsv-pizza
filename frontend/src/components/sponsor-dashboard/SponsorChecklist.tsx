import React from 'react';
import { Checkbox } from '../Checkbox';
import type { SponsorChecklistItem } from '../../types';

interface SponsorChecklistProps {
  items: SponsorChecklistItem[];
  onToggle: (itemId: string) => void;
}

export const SponsorChecklist: React.FC<SponsorChecklistProps> = ({ items, onToggle }) => {
  if (items.length === 0) {
    return (
      <div className="text-sm text-theme-text-muted py-2">
        No checklist items for this event yet.
      </div>
    );
  }

  const completedCount = items.filter(i => i.completed).length;
  const totalCount = items.length;
  const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div>
      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 h-2 bg-theme-surface rounded-full overflow-hidden">
          <div
            className="h-full bg-[#E52828] rounded-full transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <span className="text-xs text-theme-text-secondary whitespace-nowrap">
          {completedCount}/{totalCount} ({percentage}%)
        </span>
      </div>

      {/* Checklist items */}
      <div className="space-y-1.5">
        {items.map(item => (
          <div key={item.id} className="flex items-center justify-between">
            <Checkbox
              checked={item.completed}
              onChange={() => onToggle(item.id)}
              label={item.name}
              labelClassName={`text-sm ${item.completed ? 'text-theme-text-muted line-through' : 'text-theme-text'}`}
            />
            {item.dueDate && (
              <span className="text-xs text-theme-text-muted ml-2 flex-shrink-0">
                {new Date(item.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
