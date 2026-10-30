import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pizza } from 'lucide-react';
import { IconInput } from '../IconInput';
import { updateReimbursementReceiptPizza } from '../../lib/api';
import type { PayoutDocument } from '../../types';
import {
  PIZZA_SIZE_OPTIONS,
  digitsOnly,
  isStandardSize,
  lowConfidenceHint,
  parseCountInput,
  pickPizzaCountView,
  sizeSelectToBody,
  sizeSelectValue,
  summarizeSize,
} from '../../utils/pizzaCount';

interface ReceiptPizzaCountFieldsProps {
  partyId: string;
  doc: PayoutDocument;
  /** Receives the server's updated receipt so the parent can patch its list (no reload). */
  onSaved: (receipt: PayoutDocument) => void;
}

/**
 * sfincione-40417 (pizza count): optional "how many pizzas / what size" for one
 * saved receipt row. Auto-read values (confidence >= 0.7) show as a muted line
 * with Edit; otherwise a soft amber prompt with a count input + size select.
 * Always optional, always editable (also after submit), never changes money.
 */
export const ReceiptPizzaCountFields: React.FC<ReceiptPizzaCountFieldsProps> = ({ partyId, doc, onSaved }) => {
  const { t } = useTranslation('host');
  const [editorOpen, setEditorOpen] = useState(false);
  const [countDraft, setCountDraft] = useState(doc.pizzaCount != null && pickPizzaCountView(doc) !== 'prompt' ? String(doc.pizzaCount) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view = pickPizzaCountView(doc);

  // Keep the draft in step with the server value after a save / external patch,
  // but never clobber what the host is typing.
  useEffect(() => {
    if (!editorOpen) {
      setCountDraft(doc.pizzaCount != null && view !== 'prompt' ? String(doc.pizzaCount) : '');
    }
  }, [doc.pizzaCount, view, editorOpen]);

  // Duplicate / ineligible receipts don't count toward anything: no prompt.
  // (All hooks are above this early return: rules-of-hooks.)
  if (doc.isDuplicate || doc.ineligible) return null;

  const hint = lowConfidenceHint(doc);
  const showEditor = view === 'prompt' || editorOpen;

  const save = async (body: Parameters<typeof updateReimbursementReceiptPizza>[2]) => {
    setSaving(true);
    setError(null);
    try {
      const res = await updateReimbursementReceiptPizza(partyId, doc.id, body);
      onSaved(res.receipt);
    } catch (err: any) {
      setError(err?.message || t('payouts.pizzaCount.saveFailed'));
      // revert the draft to the server value
      setCountDraft(doc.pizzaCount != null && view !== 'prompt' ? String(doc.pizzaCount) : '');
    } finally {
      setSaving(false);
    }
  };

  const handleCountBlur = () => {
    const parsed = parseCountInput(countDraft);
    if (parsed === 'invalid') {
      setError(t('payouts.pizzaCount.invalidCount'));
      setCountDraft(doc.pizzaCount != null && view !== 'prompt' ? String(doc.pizzaCount) : '');
      return;
    }
    const unchanged = parsed === (doc.pizzaCount ?? null);
    // An unchanged auto value still gets saved once: that records the host's confirmation.
    const confirmsAuto = parsed !== null && doc.pizzaCountSource !== 'host';
    if (unchanged && !confirmsAuto) return;
    if (parsed === null && doc.pizzaCountSource == null) return; // nothing there, nothing typed
    void save({ pizzaCount: parsed });
  };

  const handleSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    void save(sizeSelectToBody(e.target.value));
  };

  const size = summarizeSize(doc);
  const isHost = view === 'host';

  // ---- read-only line (auto >= 0.7, or host value) ----
  if (!showEditor) {
    const sizeText =
      size?.kind === 'cm'
        ? t(isHost ? 'payouts.pizzaCount.sizeCmHost' : 'payouts.pizzaCount.sizeCmAuto', { cm: size.cm })
        : size?.kind === 'mixed'
          ? t('payouts.pizzaCount.sizeMixed')
          : size?.kind === 'word'
            ? size.word
            : null;
    return (
      <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-white/40">
        <Pizza size={12} className="flex-shrink-0" />
        <span>
          {t(isHost ? 'payouts.pizzaCount.readHost' : 'payouts.pizzaCount.readAuto', { count: doc.pizzaCount ?? 0 })}
          {sizeText ? ` · ${sizeText}` : ''}
          {!sizeText && (
            <>
              {' · '}
              <button
                type="button"
                onClick={() => setEditorOpen(true)}
                className="underline hover:text-theme-text"
              >
                {t('payouts.pizzaCount.sizeUnknown')}
              </button>
            </>
          )}
        </span>
        <button type="button" onClick={() => setEditorOpen(true)} className="underline hover:text-theme-text">
          {t('payouts.pizzaCount.edit')}
        </button>
      </div>
    );
  }

  // ---- editor (no/low-confidence value, or Edit clicked) ----
  const selectValue = sizeSelectValue(doc);
  const nonStandardCm = doc.pizzaSizeCm != null && !isStandardSize(doc.pizzaSizeCm) ? doc.pizzaSizeCm : null;
  return (
    <div className="mt-2 space-y-2">
      {view === 'prompt' && <p className="text-xs text-amber-400">{t('payouts.pizzaCount.prompt')}</p>}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 min-w-0">
          <IconInput
            icon={Pizza}
            iconSize={16}
            inputMode="numeric"
            pattern="[0-9]*"
            value={countDraft}
            disabled={saving}
            onChange={(e) => setCountDraft(digitsOnly((e.target as HTMLInputElement).value))}
            onFocus={() => setEditorOpen(true)}
            onBlur={handleCountBlur}
            placeholder={
              hint != null ? t('payouts.pizzaCount.aboutCount', { count: hint }) : t('payouts.pizzaCount.countPlaceholder')
            }
          />
        </div>
        <select
          value={selectValue}
          onChange={handleSizeChange}
          onFocus={() => setEditorOpen(true)}
          disabled={saving}
          aria-label={t('payouts.pizzaCount.sizePlaceholder')}
          className="text-sm bg-theme-surface border border-theme-stroke rounded-xl px-3 py-2 text-theme-text focus:border-[#ff393a] focus:outline-none disabled:opacity-50 sm:w-56"
        >
          <option value="">{t('payouts.pizzaCount.sizePlaceholder')}</option>
          {nonStandardCm != null && <option value={String(nonStandardCm)}>{nonStandardCm} cm</option>}
          {PIZZA_SIZE_OPTIONS.map((o) => (
            <option key={o.cm} value={String(o.cm)}>
              {o.inch}" / {o.cm} cm
            </option>
          ))}
          <option value="mixed">{t('payouts.pizzaCount.sizeMixedOption')}</option>
        </select>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs text-white/40">{t('payouts.pizzaCount.helper')}</p>
        {view !== 'prompt' && (
          <button
            type="button"
            onClick={() => setEditorOpen(false)}
            className="text-xs underline text-white/60 hover:text-theme-text"
          >
            {t('payouts.pizzaCount.done')}
          </button>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
