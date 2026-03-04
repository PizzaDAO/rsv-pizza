import React from 'react';
import { Check, X } from 'lucide-react';

interface ProgressIndicatorProps {
  done: boolean;
  label: string;
  size?: 'sm' | 'md';
}

export function ProgressIndicator({ done, label, size = 'sm' }: ProgressIndicatorProps) {
  const sizeClasses = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  const iconSize = size === 'sm' ? 12 : 14;

  return (
    <div className="flex items-center gap-1.5" title={label}>
      <div
        className={`${sizeClasses} rounded-full flex items-center justify-center ${
          done
            ? 'bg-green-500/20 text-green-400'
            : 'bg-white/5 text-white/20'
        }`}
      >
        {done ? <Check size={iconSize} /> : <X size={iconSize} />}
      </div>
      <span className={`text-xs ${done ? 'text-white/60' : 'text-white/30'}`}>
        {label}
      </span>
    </div>
  );
}
