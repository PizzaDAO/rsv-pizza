import React, { useState } from 'react';
import { Check, X, Pencil, Loader2 } from 'lucide-react';
import { IconInput } from '../IconInput';
import { updatePartyApi } from '../../lib/api';

interface CapInlineEditorProps {
  partyId: string;
  /**
   * Current effective cap (may be the validated value or a tag-derived one).
   * The editor saves to the underlying `reimbursementCapUsd` column (the
   * validated value), not the tag fallback.
   */
  currentCapUsd: number | null;
  /** Called after a successful save so the parent can refresh its data. */
  onUpdated?: (newCapUsd: number | null) => void;
}

/**
 * montasio-49102: shared inline editor for the per-event reimbursement cap,
 * used on the `/payments` admin dashboard (Prepay queue + payouts table).
 *
 * Click the cap value (or the adjacent pencil icon) to enter edit mode.
 * Enter saves, Escape cancels. An empty input clears the cap (saves `null`).
 *
 * The underboss dashboard has its own `ReimbursementCapCell` with extra
 * "suggested cap" + "validate" logic; this is the stripped-down variant for
 * admins who already know the value they want.
 */
export const CapInlineEditor: React.FC<CapInlineEditorProps> = ({
  partyId,
  currentCapUsd,
  onUpdated,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(
    currentCapUsd != null ? String(currentCapUsd) : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(currentCapUsd != null ? String(currentCapUsd) : '');
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
    setDraft(currentCapUsd != null ? String(currentCapUsd) : '');
  }

  async function save() {
    const trimmed = draft.trim();
    let value: number | null;
    if (trimmed === '') {
      value = null;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n <= 0 || n > 100000) {
        setError('Enter a positive number ≤ 100000');
        return;
      }
      value = n;
    }
    setSaving(true);
    setError(null);
    try {
      await updatePartyApi(partyId, { reimbursementCapUsd: value });
      setEditing(false);
      onUpdated?.(value);
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div
        className="inline-flex flex-col gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="inline-flex items-center gap-1">
          <IconInput
            type="number"
            step="0.01"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            disabled={saving}
            placeholder="$"
            className="!pl-2 py-1 text-xs w-[70px] bg-theme-surface border border-theme-stroke rounded text-theme-text"
            autoFocus
          />
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="p-1 rounded text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-40"
            title="Save"
          >
            {saving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Check size={12} />
            )}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className="p-1 rounded text-theme-text-faint hover:text-theme-text-muted hover:bg-theme-surface-hover disabled:opacity-40"
            title="Cancel"
          >
            <X size={12} />
          </button>
        </div>
        {error && (
          <span className="text-[10px] text-red-400" title={error}>
            {error}
          </span>
        )}
      </div>
    );
  }

  const display =
    currentCapUsd != null ? `$${Number(currentCapUsd).toLocaleString()}` : '—';

  return (
    <button
      type="button"
      onClick={startEditing}
      className="inline-flex items-center gap-1 text-theme-text hover:text-[#E52828] group"
      title="Edit reimbursement cap"
    >
      <span>{display}</span>
      <Pencil
        size={11}
        className="text-theme-text-faint group-hover:text-[#E52828]"
      />
    </button>
  );
};
