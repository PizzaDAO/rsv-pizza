import React from 'react';
import { Trash2, ExternalLink, AlertCircle } from 'lucide-react';
import { ChecklistItem, AutoCompleteStates } from '../../types';
import { Checkbox } from '../Checkbox';

interface ChecklistItemRowProps {
  item: ChecklistItem;
  autoStates: AutoCompleteStates;
  onToggle: (itemId: string) => void;
  onDelete: (itemId: string) => void;
  onNavigate?: (tab: string) => void;
}

function isItemCompleted(item: ChecklistItem, autoStates: AutoCompleteStates): boolean {
  if (item.isAuto && item.autoRule) {
    return autoStates[item.autoRule as keyof AutoCompleteStates] ?? false;
  }
  return item.completed;
}

function formatDueDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  // Handle both "2026-03-08" and "2026-03-08T00:00:00.000Z" formats
  const dateOnly = dateStr.split('T')[0];
  const date = new Date(dateOnly + 'T00:00:00');
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isOverdue(dateStr: string | null, completed: boolean): boolean {
  if (!dateStr || completed) return false;
  const dateOnly = dateStr.split('T')[0];
  const due = new Date(dateOnly + 'T23:59:59');
  return due < new Date();
}

export const ChecklistItemRow: React.FC<ChecklistItemRowProps> = ({
  item,
  autoStates,
  onToggle,
  onDelete,
  onNavigate,
}) => {
  const completed = isItemCompleted(item, autoStates);
  const overdue = isOverdue(item.dueDate, completed);
  const dueDateStr = formatDueDate(item.dueDate);

  const handleNameClick = () => {
    if (item.linkTab && onNavigate) {
      onNavigate(item.linkTab);
    }
  };

  return (
    <div className="group flex items-center gap-3 p-3 bg-theme-surface hover:bg-theme-surface-hover border border-theme-stroke rounded-xl transition-colors">
      {/* Checkbox */}
      <Checkbox
        checked={completed}
        onChange={() => onToggle(item.id)}
        label=""
        disabled={item.isAuto}
        size={20}
      />

      {/* Name + metadata */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            onClick={item.linkTab ? handleNameClick : undefined}
            className={`text-sm font-medium truncate ${
              completed
                ? 'text-theme-text-muted line-through'
                : 'text-theme-text'
            } ${item.linkTab ? 'cursor-pointer hover:text-[#ff393a] transition-colors' : ''}`}
          >
            {item.name}
          </span>
          {item.linkTab && (
            <button
              onClick={handleNameClick}
              className="text-theme-text-faint hover:text-theme-text-secondary flex-shrink-0 transition-colors"
              title={`Go to ${item.linkTab}`}
            >
              <ExternalLink size={12} />
            </button>
          )}
          {item.isAuto && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#5c7cfa]/15 text-[#5c7cfa] flex-shrink-0">
              Auto
            </span>
          )}
        </div>

        {/* Due date */}
        {dueDateStr && (
          <div className="flex items-center gap-1 mt-0.5">
            {overdue && <AlertCircle size={10} className="text-red-400" />}
            <span className={`text-xs ${overdue ? 'text-red-400 font-medium' : 'text-theme-text-muted'}`}>
              Due {dueDateStr}
            </span>
          </div>
        )}
      </div>

      {/* Delete button (only for custom items) */}
      {!item.isDefault && (
        <button
          onClick={() => onDelete(item.id)}
          className="p-1.5 rounded-lg text-theme-text-faint hover:text-red-400 hover:bg-theme-surface-hover transition-all opacity-0 group-hover:opacity-100"
          title="Delete task"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
};
