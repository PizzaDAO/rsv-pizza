import React, { useState } from "react";
import {
  User,
  Building2,
  MapPin,
  Hash,
  FileSignature,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { IconInput } from "../../IconInput";
import { Checkbox } from "../../Checkbox";

export interface W9FormData {
  name?: string;
  businessName?: string;
  taxClassification?:
    | "individual"
    | "c_corp"
    | "s_corp"
    | "partnership"
    | "trust_estate"
    | "llc_c"
    | "llc_s"
    | "llc_p"
    | "other";
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
  /**
   * culatello-92107: Called when the host realizes mid-edit that the W-9
   * isn't the right form for them (they're not a US person). The parent
   * should discard the current W-9 draft and switch the active editor to
   * W-8BEN (individual) or W-8BEN-E (entity).
   */
  onSwitchFormType?: (target: 'w8ben' | 'w8bene') => void;
}

const TAX_CLASS_OPTIONS: Array<{
  value: NonNullable<W9FormData["taxClassification"]>;
  label: string;
}> = [
  {
    value: "individual",
    label: "Individual / sole proprietor / single-member LLC",
  },
  { value: "c_corp", label: "C Corporation" },
  { value: "s_corp", label: "S Corporation" },
  { value: "partnership", label: "Partnership" },
  { value: "trust_estate", label: "Trust / estate" },
  { value: "llc_c", label: "LLC taxed as C corporation" },
  { value: "llc_s", label: "LLC taxed as S corporation" },
  { value: "llc_p", label: "LLC taxed as Partnership" },
  { value: "other", label: "Other" },
];

type TinType = "ssn" | "ein";

/**
 * W-9 host form. All fields are controlled; the parent passes `value` /
 * `onChange` so the draft can be saved as you type. Required-field validation
 * lives on the backend (POST /api/tax-forms/submit) — the submit button is
 * the place to surface failures.
 */
export const W9Form: React.FC<W9FormProps> = ({
  value,
  onChange,
  disabled,
  onSwitchFormType,
}) => {
  // Derive initial TIN type from whichever value is populated.
  // Default to 'ssn' (most common for individual hosts).
  const initialTinType: TinType = value.ein && !value.ssn ? "ein" : "ssn";
  const [tinType, setTinType] = useState<TinType>(initialTinType);
  const [showExemptCodes, setShowExemptCodes] = useState<boolean>(
    !!(value.exemptPayeeCode || value.fatcaCode || value.accountNumbers),
  );

  const set = <K extends keyof W9FormData>(key: K, v: W9FormData[K]) =>
    onChange({ ...value, [key]: v });

  // Switching TIN type clears the other field so the PDF only receives one.
  const switchTinType = (next: TinType) => {
    if (next === tinType) return;
    setTinType(next);
    if (next === "ssn") {
      onChange({ ...value, ein: "" });
    } else {
      onChange({ ...value, ssn: "" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 mb-4 flex items-start gap-3">
        <AlertCircle className="text-amber-400 [.gpp-theme_&]:text-amber-700 shrink-0 mt-0.5" size={18} />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-300 [.gpp-theme_&]:text-amber-900">
            W-9 is only for US persons
          </p>
          <p className="text-xs text-amber-100 [.gpp-theme_&]:text-amber-900 mt-1">
            Use W-9 if you're a US citizen, US resident, US LLC, or US corporation —
            regardless of where the event is hosted. If you live or are based outside
            the US, use W-8BEN (individual) or W-8BEN-E (entity) instead.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => onSwitchFormType?.('w8ben')}
              className="text-xs px-3 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 font-medium border border-amber-500/40 [.gpp-theme_&]:text-amber-900 [.gpp-theme_&]:bg-amber-500/30 [.gpp-theme_&]:hover:bg-amber-500/40 [.gpp-theme_&]:border-amber-700/40"
            >
              Switch to W-8BEN (individual)
            </button>
            <button
              type="button"
              onClick={() => onSwitchFormType?.('w8bene')}
              className="text-xs px-3 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 font-medium border border-amber-500/40 [.gpp-theme_&]:text-amber-900 [.gpp-theme_&]:bg-amber-500/30 [.gpp-theme_&]:hover:bg-amber-500/40 [.gpp-theme_&]:border-amber-700/40"
            >
              Switch to W-8BEN-E (entity)
            </button>
          </div>
        </div>
      </div>
      <div>
        <IconInput
          icon={User}
          type="text"
          placeholder="Full legal name (as on your tax return)"
          value={value.name ?? ""}
          onChange={(e) => set("name", e.target.value)}
          disabled={disabled}
          required
        />
      </div>
      <div>
        <IconInput
          icon={Building2}
          type="text"
          placeholder="Business name (if different from above)"
          value={value.businessName ?? ""}
          onChange={(e) => set("businessName", e.target.value)}
          disabled={disabled}
        />
      </div>

      <div>
        <p className="text-xs text-theme-text-muted mb-1">
          Federal tax classification
        </p>
        <select
          value={value.taxClassification ?? ""}
          onChange={(e) =>
            set(
              "taxClassification",
              (e.target.value || undefined) as W9FormData["taxClassification"],
            )
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

      <IconInput
        icon={MapPin}
        type="text"
        placeholder="Address (number, street, apt / suite)"
        value={value.address ?? ""}
        onChange={(e) => set("address", e.target.value)}
        disabled={disabled}
        required
      />
      <IconInput
        icon={MapPin}
        type="text"
        placeholder="City, state, and ZIP code"
        value={value.cityStateZip ?? ""}
        onChange={(e) => set("cityStateZip", e.target.value)}
        disabled={disabled}
        required
      />

      <div>
        <p className="text-xs text-theme-text-muted mb-2">
          Taxpayer Identification Number (TIN)
        </p>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-2">
          <label
            className={`flex items-center gap-2 cursor-pointer text-sm text-theme-text ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <input
              type="radio"
              name="w9-tin-type"
              value="ssn"
              checked={tinType === "ssn"}
              onChange={() => switchTinType("ssn")}
              disabled={disabled}
              className="accent-[#ff393a]"
            />
            <span>SSN (individual / sole proprietor)</span>
          </label>
          <label
            className={`flex items-center gap-2 cursor-pointer text-sm text-theme-text ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <input
              type="radio"
              name="w9-tin-type"
              value="ein"
              checked={tinType === "ein"}
              onChange={() => switchTinType("ein")}
              disabled={disabled}
              className="accent-[#ff393a]"
            />
            <span>EIN (business entity)</span>
          </label>
        </div>
        {tinType === "ssn" ? (
          <IconInput
            icon={Hash}
            type="text"
            placeholder="XXX-XX-XXXX"
            value={value.ssn ?? ""}
            onChange={(e) => set("ssn", e.target.value)}
            disabled={disabled}
          />
        ) : (
          <IconInput
            icon={Hash}
            type="text"
            placeholder="XX-XXXXXXX"
            value={value.ein ?? ""}
            onChange={(e) => set("ein", e.target.value)}
            disabled={disabled}
          />
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowExemptCodes((prev) => !prev)}
          className="flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text transition-colors"
          aria-expanded={showExemptCodes}
        >
          {showExemptCodes ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
          <span>Advanced — for institutional payees only</span>
        </button>
        {showExemptCodes && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-theme-text-muted">
              These fields apply to government agencies, tax-exempt
              organizations, financial institutions, or corporate payees with
              internal account references.{" "}
              <strong>
                If you're an individual or small business, leave all three
                blank.
              </strong>
            </p>
            <IconInput
              icon={Hash}
              type="text"
              placeholder="Exempt payee code (e.g. 1 = US govt, 2 = 501(a) org)"
              value={value.exemptPayeeCode ?? ""}
              onChange={(e) => set("exemptPayeeCode", e.target.value)}
              disabled={disabled}
            />
            <IconInput
              icon={Hash}
              type="text"
              placeholder="FATCA reporting code (A through M; rarely applies)"
              value={value.fatcaCode ?? ""}
              onChange={(e) => set("fatcaCode", e.target.value)}
              disabled={disabled}
            />
            <IconInput
              icon={Hash}
              type="text"
              placeholder="Optional — leave blank unless your accountant needs a reference"
              value={value.accountNumbers ?? ""}
              onChange={(e) => set("accountNumbers", e.target.value)}
              disabled={disabled}
            />
          </div>
        )}
      </div>

      <div className="pt-2">
        <Checkbox
          checked={!!value.certify}
          onChange={() => set("certify", !value.certify)}
          label="I certify, under penalties of perjury, that the information above is correct and I am a U.S. person."
          labelClassName="text-xs text-theme-text"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <IconInput
          icon={FileSignature}
          type="text"
          placeholder="Signature (type your full name)"
          value={value.signature ?? ""}
          onChange={(e) => set("signature", e.target.value)}
          disabled={disabled}
          required
        />
        <IconInput
          icon={CalendarDays}
          type="date"
          placeholder="Date"
          value={value.date ?? ""}
          onChange={(e) => set("date", e.target.value)}
          disabled={disabled}
          required
        />
      </div>
    </div>
  );
};
