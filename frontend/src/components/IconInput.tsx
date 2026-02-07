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


type InputProps = BaseProps & React.InputHTMLAttributes<HTMLInputElement> & { multiline?: false };
type TextareaProps = BaseProps & React.TextareaHTMLAttributes<HTMLTextAreaElement> & { multiline: true };

type IconInputProps = InputProps | TextareaProps;

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
