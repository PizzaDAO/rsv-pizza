import React, { forwardRef } from 'react';
import { LucideIcon } from 'lucide-react';

interface IconInputBaseProps {
  icon?: LucideIcon;
  customIcon?: React.ReactNode;
  iconSize?: number;
}

/** Single-line mode: renders an `<input>`, handlers receive HTMLInputElement events. */
type SingleLineProps = IconInputBaseProps &
  React.InputHTMLAttributes<HTMLInputElement> & { multiline?: false };

/** `multiline` mode: renders a `<textarea>`, handlers receive HTMLTextAreaElement events. */
type MultilineProps = IconInputBaseProps &
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { multiline: true; rows?: number };

export type IconInputProps = SingleLineProps | MultilineProps;

export const IconInput = forwardRef<HTMLInputElement | HTMLTextAreaElement, IconInputProps>(
  (allProps, ref) => {
    const { icon: Icon, customIcon, iconSize = 20, className = '', placeholder, required, multiline, ...props } = allProps;
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
      const { rows = 3, ...textareaProps } = props as Omit<MultilineProps, keyof IconInputBaseProps | 'className' | 'placeholder' | 'required' | 'multiline'>;
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
          {...(props as React.InputHTMLAttributes<HTMLInputElement>)}
        />
      </div>
    );
  }
);

IconInput.displayName = 'IconInput';
