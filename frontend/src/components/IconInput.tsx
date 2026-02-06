import React, { forwardRef } from 'react';
import { LucideIcon } from 'lucide-react';

interface IconInputBaseProps {
  icon: LucideIcon;
  iconSize?: number;
}

type IconInputProps = IconInputBaseProps &
  (({ multiline: true } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) |
  ({ multiline?: false } & React.InputHTMLAttributes<HTMLInputElement>));

export const IconInput = forwardRef<HTMLInputElement | HTMLTextAreaElement, IconInputProps>(
  ({ icon: Icon, iconSize = 20, className = '', multiline, ...props }, ref) => {
    return (
      <div className="relative">
        <Icon
          size={iconSize}
          className={`absolute left-3 ${multiline ? 'top-3' : 'top-1/2 -translate-y-1/2'} text-white/40 pointer-events-none`}
        />
        {multiline ? (
          <textarea
            ref={ref as React.Ref<HTMLTextAreaElement>}
            className={`w-full !pl-14 min-h-[80px] resize-y ${className}`}
            {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          />
        ) : (
          <input
            ref={ref as React.Ref<HTMLInputElement>}
            className={`w-full !pl-14 ${className}`}
            {...(props as React.InputHTMLAttributes<HTMLInputElement>)}
          />
        )}
      </div>
    );
  }
);

IconInput.displayName = 'IconInput';
