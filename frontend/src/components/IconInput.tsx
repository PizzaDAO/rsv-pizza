import React, { forwardRef } from 'react';
import { LucideIcon } from 'lucide-react';

type BaseProps = {
  icon: LucideIcon;
  iconSize?: number;
};

type InputProps = BaseProps & React.InputHTMLAttributes<HTMLInputElement> & { multiline?: false };
type TextareaProps = BaseProps & React.TextareaHTMLAttributes<HTMLTextAreaElement> & { multiline: true };

type IconInputProps = InputProps | TextareaProps;

export const IconInput = forwardRef<HTMLInputElement | HTMLTextAreaElement, IconInputProps>(
  ({ icon: Icon, iconSize = 20, className = '', multiline, placeholder, required, ...props }, ref) => {
    const displayPlaceholder = placeholder && required && !placeholder.endsWith('*')
      ? `${placeholder}*`
      : placeholder;
  multiline?: boolean;
  rows?: number;
};

type IconInputProps = BaseProps &
  (
    | (Omit<React.InputHTMLAttributes<HTMLInputElement>, keyof BaseProps> & { multiline?: false })
    | (Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, keyof BaseProps> & { multiline: true })
  );

export const IconInput = forwardRef<HTMLInputElement | HTMLTextAreaElement, IconInputProps>(
  ({ icon: Icon, iconSize = 20, className = '', multiline, rows = 2, placeholder, required, ...props }, ref) => {
    const displayPlaceholder = placeholder && required && !placeholder.endsWith('*')
      ? `${placeholder} *`
      : placeholder;

    if (multiline) {
      return (
        <div className="relative">
          <Icon
            size={iconSize}
            className="absolute left-3 top-3 text-white/40 pointer-events-none"
          />
          <textarea
            ref={ref as React.Ref<HTMLTextAreaElement>}
            className={`w-full !pl-14 resize-none ${className}`}
            placeholder={displayPlaceholder}
            required={required}
            rows={rows}
            {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          />
        </div>
      );
    }

    return (
      <div className="relative">
        <Icon
          size={iconSize}
          className={`absolute left-3 ${multiline ? 'top-3' : 'top-1/2 -translate-y-1/2'} text-white/40 pointer-events-none`}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
        />
        <input
          ref={ref as React.Ref<HTMLInputElement>}
          className={`w-full !pl-14 ${className}`}
          placeholder={displayPlaceholder}
          required={required}
          {...(props as React.InputHTMLAttributes<HTMLInputElement>)}
        />
        {multiline ? (
          <textarea
            ref={ref as React.Ref<HTMLTextAreaElement>}
            className={`w-full !pl-14 resize-none ${className}`}
            rows={(props as TextareaProps).rows || 3}
            placeholder={displayPlaceholder}
            required={required}
            {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          />
        ) : (
          <input
            ref={ref as React.Ref<HTMLInputElement>}
            className={`w-full !pl-14 ${className}`}
            placeholder={displayPlaceholder}
            required={required}
            {...(props as React.InputHTMLAttributes<HTMLInputElement>)}
          />
        )}
      </div>
    );
  }
);

IconInput.displayName = 'IconInput';
