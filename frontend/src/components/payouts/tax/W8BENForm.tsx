import React, { useEffect, useMemo, useRef } from 'react';
import { User, Globe, MapPin, Hash, FileSignature, CalendarDays, AlertTriangle, Info } from 'lucide-react';
import { IconInput } from '../../IconInput';
import { Checkbox } from '../../Checkbox';
import { LocationAutocomplete } from '../../LocationAutocomplete';
import { lookupTreaty, normalizeCountryCode } from '../../../utils/taxTreaties';

export interface W8BENFormData {
  name?: string;
  citizenship?: string;
  permanentAddress?: string;
  permanentCity?: string;
  // prosciutto-92107: split address into structured fields.
  permanentStateProvince?: string;
  permanentPostalCode?: string;
  permanentCountry?: string;
  mailingAddress?: string;
  mailingCity?: string;
  mailingStateProvince?: string;
  mailingPostalCode?: string;
  mailingCountry?: string;
  usTin?: string;
  foreignTin?: string;
  referenceNumbers?: string;
  dateOfBirth?: string;
  treatyCountry?: string;
  articleParagraph?: string;
  withholdingRate?: string;
  incomeType?: string;
  treatyExplanation?: string;
  /**
   * mortadella-92107: tracks the last country we ran auto-fill against so we
   * don't re-overwrite host edits after the host typed over a suggested value.
   * Stored in the saved form data so draft round-trips behave the same.
   */
  treatyAutoFilledFor?: string;
  certify?: boolean;
  signature?: string;
  date?: string;
}

interface W8BENFormProps {
  value: W8BENFormData;
  onChange: (next: W8BENFormData) => void;
  disabled?: boolean;
  /**
   * prosciutto-92107: surfaced when the picked permanent-residence country is
   * the United States — W-8BEN is for foreign persons only. Parent component
   * should discard the W-8BEN draft and switch the editor to W-9.
   */
  onSwitchFormType?: (target: 'w9') => void;
}

// prosciutto-92107: case-insensitive US match. Google Places returns
// "United States"; the IRS treats territories (PR, GU, USVI) as US for W-9 vs
// W-8 purposes too — keep the list small but cover the common picks.
const US_COUNTRY_NAMES = new Set([
  'united states',
  'united states of america',
  'usa',
  'us',
  'puerto rico',
  'guam',
  'u.s. virgin islands',
  'us virgin islands',
  'american samoa',
  'northern mariana islands',
]);
const isUSCountry = (country?: string | null): boolean => {
  if (!country) return false;
  return US_COUNTRY_NAMES.has(country.trim().toLowerCase());
};

export const W8BENForm: React.FC<W8BENFormProps> = ({ value, onChange, disabled, onSwitchFormType }) => {
  // ----- hooks (must stay above any early returns per react-hooks rules) -----
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  // crocchetta-92107: default the signature Date field to today (YYYY-MM-DD) on
  // fresh mount. Saved drafts with an existing date are left untouched; the
  // effect only fires once so subsequent user edits remain authoritative.
  useEffect(() => {
    const v = valueRef.current;
    if (!v.date || v.date.trim() === '') {
      const today = new Date().toISOString().slice(0, 10);
      onChangeRef.current({ ...v, date: today });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The treaty-claim country defaults to permanentCountry (typical case:
  // host is claiming benefits under their country of residence's treaty).
  // We watch that field and auto-suggest article + rate + income type.
  const treatyKey = (value.treatyCountry?.trim() || value.permanentCountry?.trim() || '').trim();
  const treatyEntry = useMemo(() => lookupTreaty(treatyKey), [treatyKey]);
  const treatyCode = useMemo(() => normalizeCountryCode(treatyKey), [treatyKey]);

  useEffect(() => {
    if (disabled) return;
    if (!treatyKey) return;
    // Identify the country canonically (ISO-2) so retyping the same country
    // in a different form doesn't re-trigger auto-fill.
    const cacheKey = treatyCode || treatyKey.toLowerCase();
    const v = valueRef.current;
    if (v.treatyAutoFilledFor === cacheKey) return;
    if (!treatyEntry) {
      // Unknown country — mark cache so we don't loop, but don't touch fields.
      onChangeRef.current({ ...v, treatyAutoFilledFor: cacheKey });
      return;
    }
    if (!treatyEntry.hasTreaty) {
      // No treaty — clear any auto-filled values; surface the amber note via render.
      onChangeRef.current({
        ...v,
        treatyCountry: v.treatyCountry ?? v.permanentCountry ?? '',
        articleParagraph: '',
        withholdingRate: '',
        incomeType: '',
        treatyAutoFilledFor: cacheKey,
      });
      return;
    }
    onChangeRef.current({
      ...v,
      treatyCountry: v.treatyCountry || v.permanentCountry || '',
      articleParagraph: treatyEntry.article ?? '',
      withholdingRate: String(treatyEntry.otherIncomeRate),
      incomeType: 'Other income',
      treatyAutoFilledFor: cacheKey,
    });
  }, [treatyKey, treatyCode, treatyEntry, disabled]);

  const set = <K extends keyof W8BENFormData>(key: K, v: W8BENFormData[K]) =>
    onChange({ ...value, [key]: v });

  // When the host edits the treaty-claim country directly, reset the cache so
  // the effect re-runs against the new country.
  const setTreatyCountry = (v: string) => {
    onChange({ ...value, treatyCountry: v, treatyAutoFilledFor: undefined });
  };

  return (
    <div className="space-y-4">
      <IconInput
        icon={User}
        type="text"
        placeholder="Full legal name"
        value={value.name ?? ''}
        onChange={(e) => set('name', e.target.value)}
        disabled={disabled}
        required
      />
      <IconInput
        icon={Globe}
        type="text"
        placeholder="Country of citizenship"
        value={value.citizenship ?? ''}
        onChange={(e) => set('citizenship', e.target.value)}
        disabled={disabled}
        required
      />

      <div className="space-y-2">
        <p className="text-xs text-theme-text-muted">Permanent residence address</p>
        {/* prosciutto-92107: Google Places autocomplete on the street input.
            On pick, fills City / State or Province / Postal Code / Country.
            Each field remains individually editable. */}
        <LocationAutocomplete
          value={value.permanentAddress ?? ''}
          onChange={(v) => set('permanentAddress', v)}
          onCitySelected={(cityData) => {
            const nextAddress = cityData.street || value.permanentAddress || cityData.formattedName || '';
            onChange({
              ...value,
              permanentAddress: nextAddress,
              permanentCity: cityData.cityName || value.permanentCity || '',
              permanentStateProvince: cityData.state || value.permanentStateProvince || '',
              permanentPostalCode: cityData.postalCode || value.permanentPostalCode || '',
              permanentCountry: cityData.country || value.permanentCountry || '',
              // Re-evaluate treaty auto-fill against the newly picked country.
              treatyAutoFilledFor: undefined,
            });
          }}
          disabled={disabled}
          placeholder="Street, apt / suite"
          types={['geocode', 'establishment']}
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
            placeholder="State or province"
            value={value.permanentStateProvince ?? ''}
            onChange={(e) => set('permanentStateProvince', e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <IconInput
            icon={MapPin}
            type="text"
            placeholder="Postal code"
            value={value.permanentPostalCode ?? ''}
            onChange={(e) => set('permanentPostalCode', e.target.value)}
            disabled={disabled}
          />
          <IconInput
            icon={MapPin}
            type="text"
            placeholder="Country"
            value={value.permanentCountry ?? ''}
            onChange={(e) => {
              // Clearing the cache lets the effect re-evaluate against the
              // new country if treatyCountry hasn't been overridden.
              onChange({ ...value, permanentCountry: e.target.value, treatyAutoFilledFor: undefined });
            }}
            disabled={disabled}
            required
          />
        </div>
        {isUSCountry(value.permanentCountry) && (
          <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/10 mt-2">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-amber-300 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-xs text-amber-100 [.gpp-theme_&]:text-amber-900">
                  <strong>W-8BEN is for foreign persons.</strong> Your permanent
                  residence can't be in the United States. If you're a US person,
                  use W-9 instead.
                </div>
                {onSwitchFormType && (
                  <button
                    type="button"
                    onClick={() => onSwitchFormType('w9')}
                    className="mt-2 text-xs px-3 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 font-medium border border-amber-500/40 [.gpp-theme_&]:text-amber-900 [.gpp-theme_&]:bg-amber-500/30 [.gpp-theme_&]:hover:bg-amber-500/40 [.gpp-theme_&]:border-amber-700/40"
                  >
                    Switch to W-9
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs text-theme-text-muted">Mailing address (if different)</p>
        <LocationAutocomplete
          value={value.mailingAddress ?? ''}
          onChange={(v) => set('mailingAddress', v)}
          onCitySelected={(cityData) => {
            const nextAddress = cityData.street || value.mailingAddress || cityData.formattedName || '';
            onChange({
              ...value,
              mailingAddress: nextAddress,
              mailingCity: cityData.cityName || value.mailingCity || '',
              mailingStateProvince: cityData.state || value.mailingStateProvince || '',
              mailingPostalCode: cityData.postalCode || value.mailingPostalCode || '',
              mailingCountry: cityData.country || value.mailingCountry || '',
            });
          }}
          disabled={disabled}
          placeholder="Street, apt / suite"
          types={['geocode', 'establishment']}
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
            placeholder="State or province"
            value={value.mailingStateProvince ?? ''}
            onChange={(e) => set('mailingStateProvince', e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <IconInput
            icon={MapPin}
            type="text"
            placeholder="Postal code"
            value={value.mailingPostalCode ?? ''}
            onChange={(e) => set('mailingPostalCode', e.target.value)}
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
          placeholder="US TIN (SSN / ITIN, optional)"
          value={value.usTin ?? ''}
          onChange={(e) => set('usTin', e.target.value)}
          disabled={disabled}
        />
        <IconInput
          icon={Hash}
          type="text"
          placeholder="Foreign TIN"
          value={value.foreignTin ?? ''}
          onChange={(e) => set('foreignTin', e.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <IconInput
          icon={Hash}
          type="text"
          placeholder="Reference number(s)"
          value={value.referenceNumbers ?? ''}
          onChange={(e) => set('referenceNumbers', e.target.value)}
          disabled={disabled}
        />
        <IconInput
          icon={CalendarDays}
          type="date"
          placeholder="Date of birth"
          value={value.dateOfBirth ?? ''}
          onChange={(e) => set('dateOfBirth', e.target.value)}
          disabled={disabled}
          required
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs text-theme-text-muted">Tax treaty claim (optional)</p>
        <p className="text-[11px] text-theme-text-muted/80 leading-relaxed">
          This is general guidance based on IRS Publication 901, not tax advice. Consult a tax
          professional if you're unsure.
        </p>
        <IconInput
          icon={Globe}
          type="text"
          placeholder="Country for tax treaty claim"
          value={value.treatyCountry ?? ''}
          onChange={(e) => setTreatyCountry(e.target.value)}
          disabled={disabled}
        />
        {treatyKey && treatyEntry?.hasTreaty && (
          <div className="flex items-start gap-1.5 text-[11px] text-theme-text-muted">
            <Info size={12} className="mt-0.5 flex-shrink-0" />
            <span>
              Auto-filled based on {treatyKey}'s US tax treaty (Other income at{' '}
              {treatyEntry.otherIncomeRate}% under {treatyEntry.article}). Edit if needed.
              {treatyEntry.notes ? ` ${treatyEntry.notes}` : ''}
            </span>
          </div>
        )}
        {treatyKey && treatyEntry && !treatyEntry.hasTreaty && (
          <div className="card p-2.5 border-l-4 border-l-amber-500 bg-amber-500/10">
            <div className="flex items-start gap-2 text-[11px] text-amber-100">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <span>
                No US tax treaty in force with {treatyKey} — leave the treaty fields blank; default
                30% withholding applies if classified as US-source income.
                {treatyEntry.notes ? ` ${treatyEntry.notes}` : ''}
              </span>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <IconInput
            icon={Hash}
            type="text"
            placeholder="Article + paragraph"
            value={value.articleParagraph ?? ''}
            onChange={(e) => set('articleParagraph', e.target.value)}
            disabled={disabled}
          />
          <IconInput
            icon={Hash}
            type="text"
            placeholder="Withholding rate (%)"
            value={value.withholdingRate ?? ''}
            onChange={(e) => set('withholdingRate', e.target.value)}
            disabled={disabled}
          />
          <IconInput
            icon={Hash}
            type="text"
            placeholder="Type of income"
            value={value.incomeType ?? ''}
            onChange={(e) => set('incomeType', e.target.value)}
            disabled={disabled}
          />
        </div>
        <IconInput
          icon={Hash}
          multiline
          rows={2}
          placeholder="Explanation for treaty claim (optional)"
          value={value.treatyExplanation ?? ''}
          onChange={(e) => set('treatyExplanation', e.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="pt-2">
        <Checkbox
          checked={!!value.certify}
          onChange={() => set('certify', !value.certify)}
          label="I certify that I am the beneficial owner of all income to which this form relates, that I am not a U.S. person, and the information above is true and correct."
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
