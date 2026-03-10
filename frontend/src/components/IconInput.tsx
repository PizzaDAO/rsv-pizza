import React, { forwardRef } from 'react';
import { LucideIcon } from 'lucide-react';

interface IconInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: LucideIcon;
  customIcon?: React.ReactNode;
  iconSize?: number;
  multiline?: boolean;
  rows?: number;
}

export const IconInput = forwardRef<HTMLInputElement | HTMLTextAreaElement, IconInputProps>(
  ({ icon: Icon, customIcon, iconSize = 20, className = '', placeholder, required, multiline, rows = 3, ...props }, ref) => {
    const displayPlaceholder = placeholder && required && !placeholder.endsWith('*')
      ? `${placeholder} *`
      : placeholder;

    const iconElement = customIcon || (Icon ? (
      <Icon
        size={iconSize}
        className={`absolute left-3 ${multiline ? 'top-3' : 'top-1/2 -translate-y-1/2'} text-theme-text-muted pointer-events-none`}
      />
    ) : null);

    if (multiline) {
      const { type, ...textareaProps } = props as any;
      return (
        <div className="relative">
          {iconElement}
          <textarea
            ref={ref as React.Ref<HTMLTextAreaElement>}
            className={`w-full !pl-14 resize-none ${className}`}
            placeholder={displayPlaceholder}
            required={required}
            rows={rows}
            {...textareaProps}
          />
        </div>
      );
    }

    return (
      <div className="relative">
        {iconElement}
        <input
          ref={ref as React.Ref<HTMLInputElement>}
          className={`w-full !pl-14 ${className}`}
          placeholder={displayPlaceholder}
          required={required}
          {...props}
        />
      </div>
    );
  }
);

IconInput.displayName = 'IconInput';
