import React, { useState } from 'react';
import { Check, Edit2, AlertCircle, X, Loader2 } from 'lucide-react';
import { IconInput } from '../IconInput';
import { computeSuggestedReimbursementCap } from '../../utils/reimbursementCap';
import { updatePartyApi } from '../../lib/api';
import type { UnderbossEvent } from '../../types';

interface ReimbursementCapCellProps {
  event: UnderbossEvent;
  onUpdate?: (eventId: string, updates: Partial<UnderbossEvent>) => void;
}

/**
 * Underboss-side control for the per-event reimbursement cap (arugula-38633 v2).
 *
 * States:
 *   * Unvalidated (capUsd == null) — show "Suggested: $X" + [Validate] +
 *     [Override] buttons.
 *   * Validated  (capUsd != null)  — show "$X" + [Edit] button.
 *   * If host has appealed: amber badge with hover-to-see-note.
 *
 * Falls back to deriving the city from the event name (strips "Global Pizza
 * Party " prefix) when the underboss API hasn't populated `event.city` yet.
 */
export const ReimbursementCapCell: React.FC<ReimbursementCapCellProps> = ({ event, onUpdate }) => {
  const cityName = event.city
    || event.name.replace(/^Global Pizza Party\s*/i, '').trim()
    || null;
  const confirmedRsvps = event.guestCount ?? 0;
  const { suggestedUsd, formula } = computeSuggestedReimbursementCap({
    city: cityName,
    confirmedRsvpCount: confirmedRsvps,
  });

  const currentCap = event.reimbursementCapUsd;
  const hasAppeal = !!event.reimbursementCapAppealedAt;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(
    currentCap != null ? String(currentCap) : String(suggestedUsd)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: number | null) {
    setSaving(true);
    setError(null);
    try {
      await updatePartyApi(event.id, { reimbursementCapUsd: value });
      onUpdate?.(event.id, { reimbursementCapUsd: value });
      setEditing(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    await save(suggestedUsd);
  }

  async function handleOverrideSubmit() {
    const trimmed = draft.trim();
    if (trimmed === '') {
      // Empty = clear the cap
      await save(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0 || n > 100000) {
      setError('Enter a non-negative number ≤ 100000');
      return;
    }
    await save(n);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 mt-0.5" onClick={(e) => e.stopPropagation()}>
        <span className="text-[10px] text-theme-text-faint">$</span>
        <IconInput
          icon={Edit2}
          iconSize={10}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') { e.preventDefault(); handleOverrideSubmit(); }
            if (e.key === 'Escape') { setEditing(false); setError(null); }
          }}
          placeholder={String(suggestedUsd)}
          className="!pl-6 py-0.5 text-[10px] w-16 bg-theme-surface border border-theme-stroke rounded text-theme-text"
          autoFocus
        />
        <button
          type="button"
          onClick={handleOverrideSubmit}
          disabled={saving}
          className="text-[#39d98a] hover:opacity-80 disabled:opacity-40"
          title="Save"
        >
          {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setError(null); }}
          disabled={saving}
          className="text-theme-text-faint hover:text-theme-text-muted disabled:opacity-40"
          title="Cancel"
        >
          <X size={10} />
        </button>
        {error && (
          <span className="text-[9px] text-red-400 ml-1" title={error}>!</span>
        )}
      </div>
    );
  }

  if (currentCap == null) {
    return (
      <div className="flex items-center gap-1 mt-0.5" title={formula}>
        <span className="text-[10px] text-theme-text-faint">
          Cap: <span className="text-theme-text-muted">${suggestedUsd}</span>?
        </span>
        <button
          type="button"
          onClick={handleValidate}
          disabled={saving}
          className="text-[9px] px-1 py-0.5 rounded border border-[#39d98a]/40 text-[#39d98a] hover:bg-[#39d98a]/10 transition-colors disabled:opacity-40"
          title={`Validate suggestion (${formula})`}
        >
          {saving ? '…' : 'Validate'}
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[9px] px-1 py-0.5 rounded border border-theme-stroke text-theme-text-muted hover:text-theme-text transition-colors"
          title="Override with a custom value"
        >
          Override
        </button>
        {hasAppeal && (
          <span title={event.reimbursementCapAppealNote || 'Host has appealed'}>
            <AlertCircle size={10} className="text-amber-400" />
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 mt-0.5" title={formula}>
      <span className="text-[10px] text-theme-text-muted">
        Cap: <span className="text-theme-text font-medium">${Number(currentCap).toLocaleString()}</span>
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-theme-text-faint hover:text-theme-text-muted transition-colors"
        title="Edit cap"
      >
        <Edit2 size={9} />
      </button>
      {hasAppeal && (
        <span title={event.reimbursementCapAppealNote || 'Host has appealed'}>
          <AlertCircle size={10} className="text-amber-400" />
        </span>
      )}
    </div>
  );
};
