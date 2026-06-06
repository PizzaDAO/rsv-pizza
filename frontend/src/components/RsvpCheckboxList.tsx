// lasagna-49278: DB-driven renderer for the RSVP opt-in checkboxes.
//
// Pipeline:
//   1. Filter rows: (always_show || required_tags ∩ eventTags ≠ ∅)
//                && (excluded_tags ∩ eventTags === ∅)
//                && active
//   2. Group by combined_group (null = solo, non-null = grouped).
//   3. Render one checkbox per group:
//      - Label = spokesperson's resolved label.
//        Spokesperson = lowest-position row in group.
//        For combined groups with >1 row, force label key to step1.combinedOptIn
//        (matches today's behavior).
//      - Modal: if any in-group row has info_modal_i18n_ns set OR modal_overrides
//        populated, render (i) button + portal modal. Per-locale resolution.
//      - OnClick toggles ALL opt_in_fields across all in-group rows.
//      - Checked when ALL in-group fields are true.
//      - accent_color → Tailwind class (red → #ff393a, purple → purple-500).
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckSquare2, Square, Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { useRSVPForm } from '../hooks/useRSVPForm';
import type { RsvpCheckboxConfig, ModalOverride } from '../hooks/useRsvpCheckboxConfig';

interface Props {
  config: RsvpCheckboxConfig[];
  form: ReturnType<typeof useRSVPForm>;
  eventTags: string[];
  currentLocale: string;
}

// Resolves the accent color name to a Tailwind class.
function accentClass(accent: string): string {
  switch (accent) {
    case 'purple': return 'text-purple-500';
    case 'red':
    default:       return 'text-[#ff393a]';
  }
}

// Resolves modal-link color (for the privacy / terms anchors inside the modal).
function modalLinkClass(accent: string): string {
  switch (accent) {
    case 'purple': return 'text-purple-400 hover:text-purple-300 underline';
    case 'red':
    default:       return 'text-red-400 hover:text-red-300 underline';
  }
}

// Field-name -> form state field. Mirrors the 8 known opt-in slots in useRSVPForm.
function isCheckedForField(form: ReturnType<typeof useRSVPForm>, field: string): boolean {
  switch (field) {
    case 'mailingListOptIn': return form.mailingListOptIn;
    case 'swcOptIn':         return form.swcOptIn;
    case 'swcCaOptIn':       return form.swcCaOptIn;
    case 'swcAuOptIn':       return form.swcAuOptIn;
    case 'swcEuOptIn':       return form.swcEuOptIn;
    case 'swcUkOptIn':       return form.swcUkOptIn;
    case 'swcBrOptIn':       return form.swcBrOptIn;
    case 'ethconfOptIn':     return form.ethconfOptIn;
    default:                 return false;
  }
}

// Tag-set intersection.
function intersects(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  if (!a || !b || a.length === 0 || b.length === 0) return false;
  const bset = new Set(b);
  for (const x of a) if (bset.has(x)) return true;
  return false;
}

// Returns the resolved label for one config row, in resolution order:
//   1. label_overrides[currentLocale]
//   2. t(label_i18n_key)
//   3. label_default
//   4. null (renderer hides the row)
function resolveLabel(
  row: RsvpCheckboxConfig,
  t: (key: string) => string,
  currentLocale: string,
  forceCombinedKey: boolean,
): string | null {
  const effectiveKey = forceCombinedKey ? 'step1.combinedOptIn' : row.label_i18n_key;
  const localeOverride = row.label_overrides?.[currentLocale];
  if (typeof localeOverride === 'string' && localeOverride.length > 0) return localeOverride;
  if (effectiveKey) {
    const translated = t(effectiveKey);
    if (translated && translated !== effectiveKey) return translated;
  }
  if (row.label_default && row.label_default.length > 0) return row.label_default;
  return null;
}

interface ModalCopy {
  title: string;
  description: string;
  privacyText: string | null;
  termsText: string | null;
  privacyUrl: string | null;
  termsUrl: string | null;
}

// Resolves modal copy for a row (in the rendered locale). Returns null if the
// row has no modal config.
function resolveModalCopy(
  row: RsvpCheckboxConfig,
  t: (key: string) => string,
  currentLocale: string,
): ModalCopy | null {
  const hasModal = !!row.info_modal_i18n_ns || (row.modal_overrides && Object.keys(row.modal_overrides).length > 0);
  if (!hasModal) return null;

  const localeOverride: ModalOverride = row.modal_overrides?.[currentLocale] ?? {};
  const ns = row.info_modal_i18n_ns;

  const tns = (sub: string) => {
    if (!ns) return null;
    const key = `${ns}.${sub}`;
    const v = t(key);
    return v && v !== key ? v : null;
  };

  const termsSubKey = row.info_modal_terms_key || 'termsConditions';

  return {
    title:       localeOverride.title       ?? tns('title')       ?? row.id,
    description: localeOverride.description ?? tns('description') ?? '',
    privacyText: localeOverride.privacyPolicy ?? tns('privacyPolicy'),
    termsText:   (termsSubKey === 'termsOfService'
                   ? (localeOverride.termsOfService ?? tns('termsOfService'))
                   : (localeOverride.termsConditions ?? tns('termsConditions'))),
    privacyUrl:  localeOverride.privacyUrl ?? row.info_modal_privacy_url ?? null,
    termsUrl:    localeOverride.termsUrl   ?? row.info_modal_terms_url   ?? null,
  };
}

export function RsvpCheckboxList({ config, form, eventTags, currentLocale }: Props) {
  const { t } = useTranslation('rsvp');
  const [openModalGroupKey, setOpenModalGroupKey] = useState<string | null>(null);

  const tags = eventTags || [];

  // Filter step.
  const visible = config.filter((row) => {
    if (!row.active) return false;
    if (intersects(row.excluded_tags, tags)) return false;
    if (row.always_show) return true;
    if (intersects(row.required_tags, tags)) return true;
    return false;
  });

  if (visible.length === 0) return null;

  // Group step. combined_group=null → unique per-row key (so each renders solo).
  const groupsByKey = new Map<string, RsvpCheckboxConfig[]>();
  for (const row of visible) {
    const key = row.combined_group ?? `__solo_${row.id}`;
    const arr = groupsByKey.get(key) ?? [];
    arr.push(row);
    groupsByKey.set(key, arr);
  }

  // Sort each group by position; sort groups by their spokesperson's position.
  const groups: Array<{ key: string; rows: RsvpCheckboxConfig[] }> = [];
  for (const [key, rows] of groupsByKey) {
    rows.sort((a, b) => a.position - b.position);
    groups.push({ key, rows });
  }
  groups.sort((a, b) => a.rows[0].position - b.rows[0].position);

  return (
    <>
      {groups.map(({ key: groupKey, rows }) => {
        const spokesperson = rows[0];
        const forceCombinedKey = rows.length > 1;
        const label = resolveLabel(spokesperson, t, currentLocale, forceCombinedKey);
        if (!label) {
          console.warn('[RsvpCheckboxList] no resolvable label, hiding row(s):', rows.map((r) => r.id));
          return null;
        }

        // Combined: collect all opt_in_fields across in-group rows.
        const allFields: string[] = [];
        for (const r of rows) for (const f of r.opt_in_fields) {
          if (!allFields.includes(f)) allFields.push(f);
        }
        // Checked: all in-group fields true.
        const checked = allFields.length > 0 && allFields.every((f) => isCheckedForField(form, f));

        const toggle = () => {
          const newValue = !checked;
          for (const f of allFields) form.setOptInByField(f, newValue);
        };

        // Pick the row that supplies modal copy (the spokesperson if it has
        // one, otherwise the first in-group row that does).
        const modalRow =
          (spokesperson.info_modal_i18n_ns || (spokesperson.modal_overrides && Object.keys(spokesperson.modal_overrides).length > 0))
            ? spokesperson
            : rows.find((r) => r.info_modal_i18n_ns || (r.modal_overrides && Object.keys(r.modal_overrides).length > 0));
        const modalCopy = modalRow ? resolveModalCopy(modalRow, t, currentLocale) : null;
        const accentForModal = modalRow ? modalRow.accent_color : spokesperson.accent_color;

        const accentTextClass = accentClass(spokesperson.accent_color);
        const isModalOpen = openModalGroupKey === groupKey;

        return (
          <React.Fragment key={groupKey}>
            <div className={modalCopy ? 'flex items-center gap-2' : ''}>
              <button
                type="button"
                onClick={toggle}
                className={`flex items-center gap-3 p-4 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors cursor-pointer ${modalCopy ? 'flex-1' : 'w-full'}`}
              >
                {checked ? (
                  <CheckSquare2 size={20} className={`${accentTextClass} flex-shrink-0`} />
                ) : (
                  <Square size={20} className="text-theme-text-muted flex-shrink-0" />
                )}
                <span className="text-sm text-theme-text text-left">{label}</span>
              </button>
              {modalCopy && (
                <button
                  type="button"
                  onClick={() => setOpenModalGroupKey(groupKey)}
                  className="p-3 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text"
                >
                  <Info size={18} />
                </button>
              )}
            </div>

            {modalCopy && isModalOpen && createPortal(
              <div
                className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                onClick={() => setOpenModalGroupKey(null)}
              >
                <div
                  className="card p-6 max-w-md w-full relative"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => setOpenModalGroupKey(null)}
                    className="absolute top-3 right-3 text-theme-text-muted hover:text-theme-text transition-colors"
                  >
                    <X size={20} />
                  </button>
                  <h3 className="text-lg font-bold text-theme-text mb-3">{modalCopy.title}</h3>
                  <p className="text-sm text-theme-text-secondary leading-relaxed">
                    {modalCopy.description}
                    {(modalCopy.privacyText || modalCopy.termsText) && ' '}
                    {modalCopy.privacyText && modalCopy.privacyUrl && (
                      <a
                        href={modalCopy.privacyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={modalLinkClass(accentForModal)}
                      >
                        {modalCopy.privacyText}
                      </a>
                    )}
                    {modalCopy.privacyText && modalCopy.termsText && ' and '}
                    {modalCopy.termsText && modalCopy.termsUrl && (
                      <a
                        href={modalCopy.termsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={modalLinkClass(accentForModal)}
                      >
                        {modalCopy.termsText}
                      </a>
                    )}
                    {(modalCopy.privacyText || modalCopy.termsText) && '.'}
                  </p>
                </div>
              </div>,
              document.body,
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}
