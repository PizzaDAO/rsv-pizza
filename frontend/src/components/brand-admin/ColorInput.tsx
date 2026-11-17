import React from 'react';
import { IconInput } from '../IconInput';

interface ColorInputProps {
  /** Placeholder (and accessible name) for the hex field, e.g. "Page background". */
  label: string;
  value: string;
  onChange: (hex: string) => void;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * A colour field: a native colour swatch (in IconInput's icon slot) plus a hex IconInput. The hex
 * text is the source of truth, so a half-typed value is kept as typed and flagged until it is a
 * full #rrggbb.
 */
export const ColorInput: React.FC<ColorInputProps> = ({ label, value, onChange }) => {
  const valid = HEX.test(value);
  return (
    <div>
      <IconInput
        customIcon={
          <span className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center">
            <input
              type="color"
              aria-label={`${label} colour picker`}
              value={valid ? value.toLowerCase() : '#000000'}
              onChange={(e) => onChange(e.target.value)}
              className="cursor-pointer bg-transparent"
              style={{ width: 28, height: 28, minWidth: 28, padding: 0, border: 0, borderRadius: 6 }}
            />
          </span>
        }
        aria-label={label}
        placeholder={`${label} (#rrggbb)`}
        value={value}
        maxLength={7}
        spellCheck={false}
        autoCapitalize="off"
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const v = e.target.value.trim();
          onChange(v && !v.startsWith('#') ? `#${v}` : v);
        }}
        className={valid ? '' : '!border-[#E52828]'}
      />
      <div className="text-xs text-theme-text-muted mt-1">
        {label}
        {!valid && <span className="text-[#E52828]"> · use a full colour like #1a1a1a</span>}
      </div>
    </div>
  );
};
