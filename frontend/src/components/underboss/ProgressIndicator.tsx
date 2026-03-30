import React from 'react';
import { Check, X } from 'lucide-react';

interface ProgressIndicatorProps {
  done: boolean;
  label: string;
  size?: 'sm' | 'md';
  compact?: boolean;
}

export function ProgressIndicator({ done, label, size = 'sm', compact = false }: ProgressIndicatorProps) {
  if (compact) {
    return (
      <div
        className={`w-4 h-4 rounded-full flex items-center justify-center ${
          done ? 'bg-green-500/20 text-green-400' : 'bg-theme-surface text-theme-text-faint'
        }`}
        title={label}
      >
        {done ? <Check size={10} /> : <X size={10} />}
      </div>
    );
  }

  const sizeClasses = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  const iconSize = size === 'sm' ? 12 : 14;

  return (
    <div className="flex items-center gap-1.5" title={label}>
      <div
        className={`${sizeClasses} rounded-full flex items-center justify-center ${
          done
            ? 'bg-green-500/20 text-green-400'
            : 'bg-theme-surface text-theme-text-faint'
        }`}
      >
        {done ? <Check size={iconSize} /> : <X size={iconSize} />}
      </div>
      <span className={`text-xs ${done ? 'text-theme-text-secondary' : 'text-theme-text-faint'}`}>
        {label}
      </span>
    </div>
  );
}
