import React, { useEffect, useRef, useState } from "react";
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

// Top-level entity category. The actual saved `taxClassification` enum value
// is derived from `(category, llcSub)` so we don't break the PDF generator's
// existing field name set.
type ClassCategory =
  | "individual"
  | "c_corp"
  | "s_corp"
  | "partnership"
  | "trust_estate"
  | "llc"
  | "other";

type LlcSub = "c" | "s" | "p" | "disregarded";

const CATEGORY_OPTIONS: Array<{ value: ClassCategory; label: string }> = [
  { value: "individual", label: "Individual / sole proprietor" },
  { value: "c_corp", label: "C Corporation" },
  { value: "s_corp", label: "S Corporation" },
  { value: "partnership", label: "Partnership" },
  { value: "trust_estate", label: "Trust / estate" },
  { value: "llc", label: "Limited liability company (LLC)" },
  { value: "other", label: "Other" },
];

const LLC_SUB_OPTIONS: Array<{ value: LlcSub; label: string }> = [
  { value: "c", label: "C corporation" },
  { value: "s", label: "S corporation" },
  { value: "p", label: "Partnership" },
  {
    value: "disregarded",
    label: "Disregarded entity (single-member LLC)",
  },
];

type TinType = "ssn" | "ein";

// Map the saved enum value back into the (category, llcSub) UI pair.
const deriveCategoryFromValue = (
  v: W9FormData["taxClassification"],
): { category: ClassCategory | ""; llcSub: LlcSub | "" } => {
  switch (v) {
    case "individual":
      return { category: "individual", llcSub: "" };
    case "c_corp":
      return { category: "c_corp", llcSub: "" };
    case "s_corp":
      return { category: "s_corp", llcSub: "" };
    case "partnership":
      return { category: "partnership", llcSub: "" };
    case "trust_estate":
      return { category: "trust_estate", llcSub: "" };
    case "llc_c":
      return { category: "llc", llcSub: "c" };
    case "llc_s":
      return { category: "llc", llcSub: "s" };
    case "llc_p":
      return { category: "llc", llcSub: "p" };
    case "other":
      return { category: "other", llcSub: "" };
    default:
      return { category: "", llcSub: "" };
  }
};

// Encode (category, llcSub) back to the saved enum.
// LLC disregarded entity collapses to `individual` per the W-9 instructions:
// a single-member LLC owned by an individual checks the "Individual/sole
// proprietor/single-member LLC" box and uses the owner's TIN.
const encodeClassification = (
  category: ClassCategory | "",
  llcSub: LlcSub | "",
): W9FormData["taxClassification"] | undefined => {
  if (!category) return undefined;
  if (category === "llc") {
    if (llcSub === "c") return "llc_c";
    if (llcSub === "s") return "llc_s";
    if (llcSub === "p") return "llc_p";
    if (llcSub === "disregarded") return "individual";
    return undefined;
  }
  return category as W9FormData["taxClassification"];
};

// Decide what "Line 1 — name" should be in the user's words, based on what
// they picked. Individual/sole prop/LLC disregarded -> owner's personal name.
// All other entities -> business legal name.
const getLine1Placeholder = (
  category: ClassCategory | "",
  llcSub: LlcSub | "",
): string => {
  if (!category) return "Full legal name (as on your tax return)";
  if (category === "individual")
    return "Your legal name (must match your SSN)";
  if (category === "llc" && llcSub === "disregarded")
    return "OWNER'S legal name (the LLC is disregarded)";
  // C/S corp, partnership, trust/estate, LLC taxed as C/S/P, other
  return "Business legal name (must match your EIN)";
};

const getLine1Helper = (
  category: ClassCategory | "",
  llcSub: LlcSub | "",
): string | null => {
  if (!category) return null;
  if (category === "individual")
    return "Enter your personal name exactly as it appears on your tax return.";
  if (category === "llc" && llcSub === "disregarded")
    return "Single-member LLC = disregarded entity. The IRS wants the OWNER'S name here, not the LLC's. The LLC name goes on the next line.";
  if (category === "llc")
    return "Enter the LLC's legal name as registered with the IRS — it must match the LLC's EIN.";
  if (category === "other")
    return "Enter the legal name of the entity exactly as it appears on its tax return.";
  return "Enter the entity's legal name as registered with the IRS — it must match its EIN.";
};

const getLine2Placeholder = (
  category: ClassCategory | "",
  llcSub: LlcSub | "",
): string => {
  if (category === "llc" && llcSub === "disregarded")
    return "LLC name (the disregarded entity)";
  return "Business / DBA name (if different from above)";
};

const getLine2Helper = (
  category: ClassCategory | "",
  llcSub: LlcSub | "",
): string | null => {
  if (category === "llc" && llcSub === "disregarded")
    return "Enter the LLC's name here. Line 1 above must be the owner's name.";
  if (category === "individual")
    return "Optional. Only fill in if you operate under a DBA / trade name that differs from your legal name.";
  if (!category) return null;
  return "Optional. Only fill in if your operating / trade name differs from Line 1.";
};

// Line 2 is hidden when it would never apply. Currently we always show it
// because every classification can have a DBA. (Kept as a helper for symmetry
// with the spec — easy to flip later if Snax wants it hidden for some path.)
const showLine2 = (_category: ClassCategory | ""): boolean => true;

const defaultTinType = (category: ClassCategory | ""): TinType => {
  if (category === "individual") return "ssn";
  if (!category) return "ssn";
  return "ein";
};

/**
 * W-9 host form. All fields are controlled; the parent passes `value` /
 * `onChange` so the draft can be saved as you type. Required-field validation
 * lives on the backend (POST /api/tax-forms/submit) — the submit button is
 * the place to surface failures.
 *
 * bocconcino-92106: Federal Tax Classification is the FIRST field. Line 1 /
 * Line 2 placeholders and helper text adapt to the chosen classification so
 * the user knows whether to enter their personal name or a business legal
 * name (and the single-member LLC "disregarded entity" rule is called out).
 * TIN type auto-pre-selects SSN for individuals and EIN for entities; the
 * user can still override.
 */
export const W9Form: React.FC<W9FormProps> = ({
  value,
  onChange,
  disabled,
  onSwitchFormType,
}) => {
  // Derive the (category, llcSub) UI pair from whatever value was saved.
  // LLC disregarded entity has the same saved enum as plain `individual`, so
  // we track it locally — once the user picks LLC -> disregarded we remember
  // it for the rest of the session.
  const derived = deriveCategoryFromValue(value.taxClassification);
  const [category, setCategory] = useState<ClassCategory | "">(derived.category);
  const [llcSub, setLlcSub] = useState<LlcSub | "">(derived.llcSub);

  // Derive initial TIN type from whichever value is populated.
  // Default to 'ssn' (most common for individual hosts).
  const initialTinType: TinType = value.ein && !value.ssn ? "ein" : "ssn";
  const [tinType, setTinType] = useState<TinType>(initialTinType);

  // Once the user manually flips the TIN radio we stop auto-flipping it on
  // classification change. Preserving their override is a small but very
  // visible UX win.
  const tinTypeManuallyChosen = useRef<boolean>(false);

  const [showExemptCodes, setShowExemptCodes] = useState<boolean>(
    !!(value.exemptPayeeCode || value.fatcaCode || value.accountNumbers),
  );

  // crocchetta-92107: default the signature Date field to today (YYYY-MM-DD) on
  // fresh mount. Saved drafts with an existing date are left untouched; the
  // effect only fires once so subsequent user edits remain authoritative.
  useEffect(() => {
    if (!value.date || value.date.trim() === "") {
      const today = new Date().toISOString().slice(0, 10);
      onChange({ ...value, date: today });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof W9FormData>(key: K, v: W9FormData[K]) =>
    onChange({ ...value, [key]: v });

  // Switching TIN type clears the other field so the PDF only receives one.
  const switchTinType = (next: TinType, manual: boolean = true) => {
    if (next === tinType) return;
    if (manual) tinTypeManuallyChosen.current = true;
    setTinType(next);
    if (next === "ssn") {
      onChange({ ...value, ein: "" });
    } else {
      onChange({ ...value, ssn: "" });
    }
  };

  const updateCategory = (nextCategory: ClassCategory | "") => {
    setCategory(nextCategory);
    // Picking a non-LLC category clears any stale LLC sub-pick.
    const nextLlcSub: LlcSub | "" = nextCategory === "llc" ? llcSub : "";
    if (nextCategory !== "llc") setLlcSub("");
    const encoded = encodeClassification(nextCategory, nextLlcSub);
    onChange({ ...value, taxClassification: encoded });

    // Auto-flip TIN type to the default for the new category — unless the
    // user has manually chosen.
    if (!tinTypeManuallyChosen.current) {
      const wantTin = defaultTinType(nextCategory);
      if (wantTin !== tinType) switchTinType(wantTin, false);
    }
  };

  const updateLlcSub = (nextSub: LlcSub | "") => {
    setLlcSub(nextSub);
    const encoded = encodeClassification("llc", nextSub);
    onChange({ ...value, taxClassification: encoded });

    // Disregarded entity uses owner's TIN (SSN), all other LLC tax
    // treatments use the LLC's EIN. Respect manual overrides.
    if (!tinTypeManuallyChosen.current) {
      const wantTin: TinType = nextSub === "disregarded" ? "ssn" : "ein";
      if (wantTin !== tinType) switchTinType(wantTin, false);
    }
  };

  const line1Placeholder = getLine1Placeholder(category, llcSub);
  const line1Helper = getLine1Helper(category, llcSub);
  const line2Placeholder = getLine2Placeholder(category, llcSub);
  const line2Helper = getLine2Helper(category, llcSub);
  const renderLine2 = showLine2(category);

  // Hide name + address + TIN until the user has picked a classification, so
  // they can't fill in the wrong kind of name before they know what's being
  // asked. Once a category is picked everything below it cascades open.
  const classificationChosen = !!category && (category !== "llc" || !!llcSub);

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
        <p className="text-xs text-theme-text-muted mb-1">
          Federal tax classification — pick this first; the name fields below
          adapt to what you choose
        </p>
        <select
          value={category}
          onChange={(e) => updateCategory(e.target.value as ClassCategory | "")}
          disabled={disabled}
          className="w-full px-3 py-2 rounded-md bg-theme-input border border-theme-stroke text-sm text-theme-text"
        >
          <option value="">Select classification…</option>
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {category === "llc" && (
          <div className="mt-2">
            <p className="text-xs text-theme-text-muted mb-1">
              LLC tax classification — how is the LLC taxed?
            </p>
            <select
              value={llcSub}
              onChange={(e) => updateLlcSub(e.target.value as LlcSub | "")}
              disabled={disabled}
              className="w-full px-3 py-2 rounded-md bg-theme-input border border-theme-stroke text-sm text-theme-text"
            >
              <option value="">Select LLC tax treatment…</option>
              {LLC_SUB_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-white/40 mt-1">
              Disregarded = single-member LLC. The IRS treats it as the
              owner; you'll enter the owner's name on Line 1 and the LLC's
              name on Line 2.
            </p>
          </div>
        )}
      </div>

      {classificationChosen && (
        <>
          <div>
            <IconInput
              icon={User}
              type="text"
              placeholder={line1Placeholder}
              value={value.name ?? ""}
              onChange={(e) => set("name", e.target.value)}
              disabled={disabled}
              required
            />
            {line1Helper && (
              <p className="text-xs text-white/40 mt-1">{line1Helper}</p>
            )}
          </div>

          {renderLine2 && (
            <div>
              <IconInput
                icon={Building2}
                type="text"
                placeholder={line2Placeholder}
                value={value.businessName ?? ""}
                onChange={(e) => set("businessName", e.target.value)}
                disabled={disabled}
              />
              {line2Helper && (
                <p className="text-xs text-white/40 mt-1">{line2Helper}</p>
              )}
            </div>
          )}

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
        </>
      )}
    </div>
  );
};
