import React from 'react';
import { Square as SquareIcon, CheckSquare2 } from 'lucide-react';

interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  size?: number;
  disabled?: boolean;
  labelClassName?: string;
  children?: React.ReactNode;
  /** Extra classes on the button (e.g. a 44px tap target). */
  className?: string;
  /** Expose it to assistive tech as a real checkbox (role + aria-checked). Opt-in so existing queries keep working. */
  checkboxRole?: boolean;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  label,
  size = 18,
  disabled = false,
  labelClassName = 'text-sm text-theme-text',
  children,
  className = '',
  checkboxRole = false,
}) => {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onChange}
      {...(checkboxRole ? { role: 'checkbox', 'aria-checked': checked, 'aria-disabled': disabled || undefined } : {})}
      className={`flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      {checked ? (
        <CheckSquare2 size={size} className="text-[#ff393a] flex-shrink-0" aria-hidden={checkboxRole || undefined} />
      ) : (
        <SquareIcon size={size} className="text-theme-text-secondary flex-shrink-0" aria-hidden={checkboxRole || undefined} />
      )}
      <span className={labelClassName}>{label}</span>
      {children}
    </button>
  );
};
