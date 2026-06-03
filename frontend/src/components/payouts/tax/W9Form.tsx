import React from 'react';
import { User, Building2, MapPin, Hash, FileSignature, CalendarDays } from 'lucide-react';
import { IconInput } from '../../IconInput';
import { Checkbox } from '../../Checkbox';

export interface W9FormData {
  name?: string;
  businessName?: string;
  taxClassification?:
    | 'individual'
    | 'c_corp'
    | 's_corp'
    | 'partnership'
    | 'trust_estate'
    | 'llc_c'
    | 'llc_s'
    | 'llc_p'
    | 'other';
  exemptPayeeCode?: string;
  fatcaCode?: string;
  address?: string;
  cityStateZip?: string;
  accountNumbers?: string;
  ssn?: string;
  ein?: string;
  certify?: boolean;
  signature?: string;
  date?: string;
}

interface W9FormProps {
  value: W9FormData;
  onChange: (next: W9FormData) => void;
  disabled?: boolean;
}

const TAX_CLASS_OPTIONS: Array<{ value: NonNullable<W9FormData['taxClassification']>; label: string }> = [
  { value: 'individual', label: 'Individual / sole proprietor / single-member LLC' },
  { value: 'c_corp', label: 'C Corporation' },
  { value: 's_corp', label: 'S Corporation' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'trust_estate', label: 'Trust / estate' },
  { value: 'llc_c', label: 'LLC taxed as C corporation' },
  { value: 'llc_s', label: 'LLC taxed as S corporation' },
  { value: 'llc_p', label: 'LLC taxed as Partnership' },
  { value: 'other', label: 'Other' },
];

/**
 * W-9 host form. All fields are controlled; the parent passes `value` /
 * `onChange` so the draft can be saved as you type. Required-field validation
 * lives on the backend (POST /api/tax-forms/submit) — the submit button is
 * the place to surface failures.
 */
export const W9Form: React.FC<W9FormProps> = ({ value, onChange, disabled }) => {
  const set = <K extends keyof W9FormData>(key: K, v: W9FormData[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-4">
      <div>
        <IconInput
          icon={User}
          type="text"
          placeholder="Full legal name (as on your tax return)"
          value={value.name ?? ''}
          onChange={(e) => set('name', e.target.value)}
          disabled={disabled}
          required
        />
      </div>
      <div>
        <IconInput
          icon={Building2}
          type="text"
          placeholder="Business name (if different from above)"
          value={value.businessName ?? ''}
          onChange={(e) => set('businessName', e.target.value)}
          disabled={disabled}
        />
      </div>

      <div>
        <p className="text-xs text-theme-text-muted mb-1">Federal tax classification</p>
        <select
          value={value.taxClassification ?? ''}
          onChange={(e) =>
            set('taxClassification', (e.target.value || undefined) as W9FormData['taxClassification'])
          }
          disabled={disabled}
          className="w-full px-3 py-2 rounded-md bg-theme-input border border-theme-stroke text-sm text-theme-text"
        >
          <option value="">Select classification…</option>
          {TAX_CLASS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <IconInput
          icon={Hash}
          type="text"
          placeholder="Exempt payee code (optional)"
          value={value.exemptPayeeCode ?? ''}
          onChange={(e) => set('exemptPayeeCode', e.target.value)}
          disabled={disabled}
        />
        <IconInput
          icon={Hash}
          type="text"
          placeholder="FATCA reporting code (optional)"
          value={value.fatcaCode ?? ''}
          onChange={(e) => set('fatcaCode', e.target.value)}
          disabled={disabled}
        />
      </div>

      <IconInput
        icon={MapPin}
        type="text"
        placeholder="Address (number, street, apt / suite)"
        value={value.address ?? ''}
        onChange={(e) => set('address', e.target.value)}
        disabled={disabled}
        required
      />
      <IconInput
        icon={MapPin}
        type="text"
        placeholder="City, state, and ZIP code"
        value={value.cityStateZip ?? ''}
        onChange={(e) => set('cityStateZip', e.target.value)}
        disabled={disabled}
        required
      />
      <IconInput
        icon={Hash}
        type="text"
        placeholder="Account number(s) (optional)"
        value={value.accountNumbers ?? ''}
        onChange={(e) => set('accountNumbers', e.target.value)}
        disabled={disabled}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <IconInput
          icon={Hash}
          type="text"
          placeholder="Social Security Number (XXX-XX-XXXX)"
          value={value.ssn ?? ''}
          onChange={(e) => set('ssn', e.target.value)}
          disabled={disabled}
        />
        <IconInput
          icon={Hash}
          type="text"
          placeholder="Employer ID Number (XX-XXXXXXX)"
          value={value.ein ?? ''}
          onChange={(e) => set('ein', e.target.value)}
          disabled={disabled}
        />
      </div>
      <p className="text-xs text-theme-text-muted">Enter one of SSN or EIN.</p>

      <div className="pt-2">
        <Checkbox
          checked={!!value.certify}
          onChange={() => set('certify', !value.certify)}
          label="I certify, under penalties of perjury, that the information above is correct and I am a U.S. person."
          labelClassName="text-xs text-theme-text"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <IconInput
          icon={FileSignature}
          type="text"
          placeholder="Signature (type your full name)"
          value={value.signature ?? ''}
          onChange={(e) => set('signature', e.target.value)}
          disabled={disabled}
          required
        />
        <IconInput
          icon={CalendarDays}
          type="date"
          placeholder="Date"
          value={value.date ?? ''}
          onChange={(e) => set('date', e.target.value)}
          disabled={disabled}
          required
        />
      </div>
    </div>
  );
};
