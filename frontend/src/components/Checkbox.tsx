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
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  label,
  size = 18,
  disabled = false,
  labelClassName = 'text-sm text-white/80',
  children
}) => {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onChange}
      className={`flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {checked ? (
        <CheckSquare2 size={size} className="text-[#ff393a] flex-shrink-0" />
      ) : (
        <SquareIcon size={size} className="text-white/40 flex-shrink-0" />
      )}
      <span className={labelClassName}>{label}</span>
      {children}
    </button>
  );
};
