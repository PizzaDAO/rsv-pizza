import React from 'react';
import { Building2, Globe, MapPin, Hash, FileSignature, CalendarDays, AlertTriangle } from 'lucide-react';
import { IconInput } from '../../IconInput';
import { Checkbox } from '../../Checkbox';

export type W8BENEEntityType =
  | 'corporation'
  | 'partnership'
  | 'simple_trust'
  | 'grantor_trust'
  | 'complex_trust'
  | 'estate'
  | 'government'
  | 'central_bank'
  | 'tax_exempt_org'
  | 'private_foundation'
  | 'international_org';

export type W8BENEChapter4Status = 'active_nffe' | 'passive_nffe' | 'ffi';

export interface W8BENEFormData {
  entityName?: string;
  countryOfIncorporation?: string;
  disregardedEntityName?: string;
  entityType?: W8BENEEntityType;
  chapter4Status?: W8BENEChapter4Status;
  permanentAddress?: string;
  permanentCity?: string;
  permanentCountry?: string;
  mailingAddress?: string;
  mailingCity?: string;
  mailingCountry?: string;
  usTin?: string;
  giin?: string;
  foreignTin?: string;
  referenceNumbers?: string;
  certify?: boolean;
  signature?: string;
  signerCapacity?: string;
  date?: string;
}

interface W8BENEFormProps {
  value: W8BENEFormData;
  onChange: (next: W8BENEFormData) => void;
  disabled?: boolean;
}

const ENTITY_TYPES: Array<{ value: W8BENEEntityType; label: string }> = [
  { value: 'corporation', label: 'Corporation' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'simple_trust', label: 'Simple trust' },
  { value: 'grantor_trust', label: 'Grantor trust' },
  { value: 'complex_trust', label: 'Complex trust' },
  { value: 'estate', label: 'Estate' },
  { value: 'government', label: 'Government' },
  { value: 'central_bank', label: 'Central bank of issue' },
  { value: 'tax_exempt_org', label: 'Tax-exempt organization' },
  { value: 'private_foundation', label: 'Private foundation' },
  { value: 'international_org', label: 'International organization' },
];

const CHAPTER4: Array<{ value: W8BENEChapter4Status; label: string; hint?: string }> = [
  { value: 'active_nffe', label: 'Active NFFE', hint: 'Most non-financial entities with substantial active business.' },
  { value: 'passive_nffe', label: 'Passive NFFE', hint: 'Holding companies, investment vehicles.' },
  { value: 'ffi', label: 'FFI', hint: 'Foreign financial institution — paper form required.' },
];

export const W8BENEForm: React.FC<W8BENEFormProps> = ({ value, onChange, disabled }) => {
  const set = <K extends keyof W8BENEFormData>(key: K, v: W8BENEFormData[K]) =>
    onChange({ ...value, [key]: v });

  const showFfiNotice = value.chapter4Status === 'ffi';

  return (
    <div className="space-y-4">
      <IconInput
        icon={Building2}
        type="text"
        placeholder="Name of organization"
        value={value.entityName ?? ''}
        onChange={(e) => set('entityName', e.target.value)}
        disabled={disabled}
        required
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <IconInput
          icon={Globe}
          type="text"
          placeholder="Country of incorporation"
          value={value.countryOfIncorporation ?? ''}
          onChange={(e) => set('countryOfIncorporation', e.target.value)}
          disabled={disabled}
          required
        />
        <IconInput
          icon={Building2}
          type="text"
          placeholder="Disregarded entity name (if any)"
          value={value.disregardedEntityName ?? ''}
          onChange={(e) => set('disregardedEntityName', e.target.value)}
          disabled={disabled}
        />
      </div>

      <div>
        <p className="text-xs text-theme-text-muted mb-1">Entity type (Chapter 3)</p>
        <select
          value={value.entityType ?? ''}
          onChange={(e) =>
            set('entityType', (e.target.value || undefined) as W8BENEEntityType | undefined)
          }
          disabled={disabled}
          className="w-full px-3 py-2 rounded-md bg-theme-input border border-theme-stroke text-sm text-theme-text"
        >
          <option value="">Select entity type…</option>
          {ENTITY_TYPES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="text-xs text-theme-text-muted mb-1">FATCA status (Chapter 4)</p>
        <div className="space-y-1.5">
          {CHAPTER4.map((c) => {
            const active = value.chapter4Status === c.value;
            return (
              <button
                key={c.value}
                type="button"
                disabled={disabled}
                onClick={() => set('chapter4Status', c.value)}
                className={[
                  'w-full text-left rounded-lg border px-3 py-2 transition-colors',
                  active
                    ? 'border-[#ff393a] bg-[#ff393a]/10'
                    : 'border-theme-stroke hover:border-theme-text-muted',
                ].join(' ')}
              >
                <div className="text-sm font-medium text-theme-text">{c.label}</div>
                {c.hint && <div className="text-xs text-theme-text-muted">{c.hint}</div>}
              </button>
            );
          })}
        </div>
        {showFfiNotice && (
          <div className="mt-2 card p-3 border-l-4 border-l-amber-500 bg-amber-500/10">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-amber-300 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-amber-100">
                FFI entities require a paper W-8BEN-E with the full FATCA classification. Please reach out to an admin.
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs text-theme-text-muted">Permanent residence address</p>
        <IconInput
          icon={MapPin}
          type="text"
          placeholder="Street, apt / suite"
          value={value.permanentAddress ?? ''}
          onChange={(e) => set('permanentAddress', e.target.value)}
          disabled={disabled}
          required
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <IconInput
            icon={MapPin}
            type="text"
            placeholder="City or town"
            value={value.permanentCity ?? ''}
            onChange={(e) => set('permanentCity', e.target.value)}
            disabled={disabled}
            required
          />
          <IconInput
            icon={MapPin}
            type="text"
            placeholder="Country"
            value={value.permanentCountry ?? ''}
            onChange={(e) => set('permanentCountry', e.target.value)}
            disabled={disabled}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-theme-text-muted">Mailing address (if different)</p>
        <IconInput
          icon={MapPin}
          type="text"
          placeholder="Street, apt / suite"
          value={value.mailingAddress ?? ''}
          onChange={(e) => set('mailingAddress', e.target.value)}
          disabled={disabled}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <IconInput
            icon={MapPin}
            type="text"
            placeholder="City or town"
            value={value.mailingCity ?? ''}
            onChange={(e) => set('mailingCity', e.target.value)}
            disabled={disabled}
          />
          <IconInput
            icon={MapPin}
            type="text"
            placeholder="Country"
            value={value.mailingCountry ?? ''}
            onChange={(e) => set('mailingCountry', e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <IconInput
          icon={Hash}
          type="text"
          placeholder="US EIN (optional)"
          value={value.usTin ?? ''}
          onChange={(e) => set('usTin', e.target.value)}
          disabled={disabled}
        />
        <IconInput
          icon={Hash}
          type="text"
          placeholder="GIIN (if applicable)"
          value={value.giin ?? ''}
          onChange={(e) => set('giin', e.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <IconInput
          icon={Hash}
          type="text"
          placeholder="Foreign TIN"
          value={value.foreignTin ?? ''}
          onChange={(e) => set('foreignTin', e.target.value)}
          disabled={disabled}
        />
        <IconInput
          icon={Hash}
          type="text"
          placeholder="Reference number(s)"
          value={value.referenceNumbers ?? ''}
          onChange={(e) => set('referenceNumbers', e.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="pt-2">
        <Checkbox
          checked={!!value.certify}
          onChange={() => set('certify', !value.certify)}
          label="I declare under penalties of perjury that the entity above is the beneficial owner, that the information is true, and that I am authorized to sign for it."
          labelClassName="text-xs text-theme-text"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          icon={Building2}
          type="text"
          placeholder="Capacity (e.g. Director)"
          value={value.signerCapacity ?? ''}
          onChange={(e) => set('signerCapacity', e.target.value)}
          disabled={disabled}
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
