import React, { useState } from 'react';
import { Check, X, Pencil, Loader2 } from 'lucide-react';
import { IconInput } from '../IconInput';
import { updatePartyApi } from '../../lib/api';

interface EstimatedAttendanceInlineEditorProps {
  partyId: string;
  /** Current host-estimated attendance (whole number) or null. */
  currentAttendance: number | null;
  /** Called after a successful save so the parent can refresh its data. */
  onUpdated?: (newAttendance: number | null) => void;
}

/**
 * bucatini-58546: shared inline editor for the per-event host-estimated
 * attendance, used on the `/payments` admin dashboard by-city sub-line.
 *
 * Clones `CapInlineEditor` but edits an integer (not currency): click the
 * value (or pencil) to edit, Enter saves, Escape cancels, empty clears to
 * null. Saves to `parties.estimated_attendance` via PATCH /api/parties/:id
 * (same auth path as the cap editor: admins + scoped underbosses on GPP).
 */
export const EstimatedAttendanceInlineEditor: React.FC<
  EstimatedAttendanceInlineEditorProps
> = ({ partyId, currentAttendance, onUpdated }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(
    currentAttendance != null ? String(currentAttendance) : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(currentAttendance != null ? String(currentAttendance) : '');
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
    setDraft(currentAttendance != null ? String(currentAttendance) : '');
  }

  async function save() {
    const trimmed = draft.trim();
    let value: number | null;
    if (trimmed === '') {
      value = null;
    } else {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 0 || n > 1000000) {
        setError('Enter a whole number 0–1000000');
        return;
      }
      value = n;
    }
    setSaving(true);
    setError(null);
    try {
      await updatePartyApi(partyId, { estimatedAttendance: value });
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
            step="1"
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
            placeholder="#"
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

  const display = currentAttendance != null ? String(currentAttendance) : '—';

  return (
    <button
      type="button"
      onClick={startEditing}
      className="inline-flex items-center gap-1 text-theme-text hover:text-[#E52828] group"
      title="Edit estimated attendance"
    >
      <span>{display}</span>
      <Pencil
        size={11}
        className="text-theme-text-faint group-hover:text-[#E52828]"
      />
    </button>
  );
};
