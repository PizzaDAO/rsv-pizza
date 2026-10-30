import React, { useState } from 'react';
import { Pizza, Pencil } from 'lucide-react';
import { IconInput } from '../IconInput';
import { updatePayoutDocument } from '../../lib/api';
import type { PayoutDocument } from '../../types';
import {
  PIZZA_SOURCE_LABEL,
  digitsOnly,
  formatPizzaChip,
  parseCountInput,
  type PizzaCountFieldsLike,
} from '../../utils/pizzaCount';

interface Props {
  doc: PayoutDocument;
  /** Optional: lets the parent sync its copy of the doc after a save. */
  onSaved?: (fields: PizzaCountFieldsLike) => void;
}

/**
 * sfincione-40417 (pizza count): admin chip ("20 pizzas · 35 cm") with a source
 * tag (OCR / AI / host) and a confidence tooltip, plus an inline editor that
 * saves through the admin document PATCH (values entered here count as host).
 * Self-contained state: the review modal's draft machinery is not involved,
 * because this never touches money.
 */
export const PizzaCountAdminChip: React.FC<Props> = ({ doc, onSaved }) => {
  const [fields, setFields] = useState<PizzaCountFieldsLike>({
    pizzaCount: doc.pizzaCount ?? null,
    pizzaCountSource: doc.pizzaCountSource ?? null,
    pizzaCountConfidence: doc.pizzaCountConfidence ?? null,
    pizzaSizeCm: doc.pizzaSizeCm ?? null,
    pizzaSizeLabel: doc.pizzaSizeLabel ?? null,
    pizzaSizeSource: doc.pizzaSizeSource ?? null,
  });
  const [editing, setEditing] = useState(false);
  const [countDraft, setCountDraft] = useState('');
  const [sizeDraft, setSizeDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (doc.kind !== 'receipt') return null;

  const chip = formatPizzaChip(fields);
  const src = fields.pizzaCountSource ? PIZZA_SOURCE_LABEL[fields.pizzaCountSource] : null;
  const conf = fields.pizzaCountConfidence;
  const tip = src
    ? `Pizza count from ${src}${conf != null ? ` (confidence ${Math.round(conf * 100)}%)` : ''}`
    : 'No pizza count yet';

  const openEditor = () => {
    setCountDraft(fields.pizzaCount != null ? String(fields.pizzaCount) : '');
    setSizeDraft(
      fields.pizzaSizeCm != null ? String(fields.pizzaSizeCm) : fields.pizzaSizeLabel === 'mixed' ? 'mixed' : '',
    );
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const parsed = parseCountInput(countDraft);
    if (parsed === 'invalid') {
      setError('Count must be a whole number 1-5000');
      return;
    }
    const sizeNum = sizeDraft && sizeDraft !== 'mixed' ? Number(sizeDraft) : null;
    if (sizeNum !== null && (!Number.isFinite(sizeNum) || sizeNum < 15 || sizeNum > 80)) {
      setError('Size must be 15-80 cm');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const patch: Parameters<typeof updatePayoutDocument>[1] = { pizzaCount: parsed };
      if (sizeDraft === 'mixed') patch.pizzaSizeMixed = true;
      else patch.pizzaSizeCm = sizeNum;
      const res = await updatePayoutDocument(doc.id, patch);
      const next: PizzaCountFieldsLike = {
        pizzaCount: res.pizzaCount ?? null,
        pizzaCountSource: res.pizzaCountSource ?? null,
        pizzaCountConfidence: res.pizzaCountConfidence ?? null,
        pizzaSizeCm: res.pizzaSizeCm ?? null,
        pizzaSizeLabel: res.pizzaSizeLabel ?? null,
        pizzaSizeSource: res.pizzaSizeSource ?? null,
      };
      setFields(next);
      onSaved?.(next);
      setEditing(false);
    } catch (err: any) {
      setError(err?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-1">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-theme-stroke text-theme-text-muted"
          title={tip}
        >
          <Pizza size={12} />
          {chip ?? 'no pizza count'}
          {src && <span className="uppercase text-[10px] font-semibold opacity-70">{src}</span>}
        </span>
        {!editing && (
          <button
            type="button"
            onClick={openEditor}
            className="inline-flex items-center gap-1 text-theme-text-muted hover:text-theme-text underline"
          >
            <Pencil size={11} /> Edit
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0">
              <IconInput
                icon={Pizza}
                iconSize={16}
                inputMode="numeric"
                value={countDraft}
                onChange={(e) => setCountDraft(digitsOnly((e.target as HTMLInputElement).value))}
                placeholder="Pizzas on this receipt"
                disabled={saving}
              />
            </div>
            <div className="flex-1 min-w-0">
              <IconInput
                value={sizeDraft === 'mixed' ? 'mixed' : sizeDraft}
                onChange={(e) => setSizeDraft((e.target as HTMLInputElement).value.trim().toLowerCase())}
                placeholder="Diameter in cm (15-80), or type: mixed"
                disabled={saving}
                icon={Pizza}
                iconSize={16}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={saving} className="btn-secondary text-xs disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="text-xs underline text-theme-text-muted">
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
};
