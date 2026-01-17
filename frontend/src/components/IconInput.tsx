import React, { forwardRef } from 'react';
import { LucideIcon } from 'lucide-react';

interface IconInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon: LucideIcon;
  iconSize?: number;
}

export const IconInput = forwardRef<HTMLInputElement, IconInputProps>(
  ({ icon: Icon, iconSize = 20, className = '', ...props }, ref) => {
    return (
      <div className="relative">
        <Icon
          size={iconSize}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
        />
        <input
          ref={ref}
          className={`w-full !pl-14 ${className}`}
          {...props}
        />
      </div>
    );
  }
);

IconInput.displayName = 'IconInput';
