import React from 'react';
import { Globe } from 'lucide-react';

interface GPPBadgeProps {
  variant?: 'small' | 'large';
  className?: string;
}

export function GPPBadge({ variant = 'small', className = '' }: GPPBadgeProps) {
  if (variant === 'large') {
    return (
      <div className={`gpp-badge bg-gradient-to-r from-[#ff6b35]/20 to-[#ff393a]/20 border border-[#ff6b35]/30 rounded-xl p-4 ${className}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#ff6b35]/20 rounded-full flex items-center justify-center">
            <Globe className="w-5 h-5 text-[#ff6b35]" />
          </div>
          <div>
            <div className="font-semibold text-white">Global Pizza Party</div>
            <div className="text-sm text-white/60">Part of the worldwide celebration</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`gpp-badge inline-flex items-center gap-1.5 bg-[#ff6b35]/20 text-[#ff6b35] px-2.5 py-1 rounded-full text-xs font-medium ${className}`}>
      <Globe className="w-3 h-3" />
      <span>Global Pizza Party</span>
    </div>
  );
}
