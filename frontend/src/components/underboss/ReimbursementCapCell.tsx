import React, { useState } from 'react';
import { Check, Edit2, AlertCircle, X, Loader2 } from 'lucide-react';
import { IconInput } from '../IconInput';
import { computeSuggestedReimbursementCap } from '../../utils/reimbursementCap';
import { updatePartyApi, reviewReimbursementCapAppeal } from '../../lib/api';
import type { UnderbossEvent } from '../../types';
import { AppealHistoryModal } from './AppealHistoryModal';

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
  const { suggestedUsd, formula } = computeSuggestedReimbursementCap({
    city: cityName,
    expectedGuests: event.expectedGuests ?? null,
  });
  const hasSuggestion = suggestedUsd != null;

  const currentCap = event.reimbursementCapUsd;
  // quattro-12847: switch from the legacy denormalized timestamp to the
  // history-table-derived `hasOpenAppeal`. Fall back to the legacy field if
  // the backend on this preview hasn't been redeployed yet.
  const hasOpenAppeal = typeof event.hasOpenAppeal === 'boolean'
    ? event.hasOpenAppeal
    : !!event.reimbursementCapAppealedAt;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(
    currentCap != null ? String(currentCap) : (suggestedUsd != null ? String(suggestedUsd) : '')
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  async function handleMarkReviewed(e: React.MouseEvent) {
    e.stopPropagation();
    if (reviewing) return;
    setReviewing(true);
    setReviewError(null);
    try {
      await reviewReimbursementCapAppeal(event.id);
      onUpdate?.(event.id, { hasOpenAppeal: false });
    } catch (err: any) {
      setReviewError(err?.message || 'Failed to mark reviewed');
    } finally {
      setReviewing(false);
    }
  }

  function renderAppealAffordance() {
    if (!hasOpenAppeal) {
      // Even with no open appeal, surface a History entry-point when there's
      // a known past appeal (so reviewers can re-read the resolved note).
      if (!event.reimbursementCapAppealedAt) return null;
      return (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setHistoryOpen(true); }}
          className="text-[9px] px-1 py-0.5 rounded border border-theme-stroke text-theme-text-faint hover:text-theme-text-muted transition-colors"
          title="View appeal history"
        >
          History
        </button>
      );
    }
    return (
      <>
        <span title={event.reimbursementCapAppealNote || 'Host has an open appeal'}>
          <AlertCircle size={10} className="text-amber-400" />
        </span>
        <button
          type="button"
          onClick={handleMarkReviewed}
          disabled={reviewing}
          className="text-[9px] px-1 py-0.5 rounded border border-theme-stroke text-theme-text-muted hover:text-theme-text transition-colors disabled:opacity-40"
          title="Mark this appeal as reviewed"
        >
          {reviewing ? <Loader2 size={9} className="inline animate-spin" /> : 'Mark reviewed'}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setHistoryOpen(true); }}
          className="text-[9px] px-1 py-0.5 rounded border border-theme-stroke text-theme-text-faint hover:text-theme-text-muted transition-colors"
          title="View appeal history"
        >
          History
        </button>
        {reviewError && (
          <span className="text-[9px] text-red-400" title={reviewError}>!</span>
        )}
      </>
    );
  }

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
    if (suggestedUsd == null) return;
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
          placeholder={suggestedUsd != null ? String(suggestedUsd) : 'amount'}
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
    if (!hasSuggestion) {
      // No expected_guests set yet — underboss must fill it in first before
      // we can produce a suggested cap. Override is still allowed (admin may
      // know the amount independently).
      return (
        <div className="flex items-center gap-1 mt-0.5" title={formula}>
          <span className="text-[10px] text-theme-text-faint italic">
            Set expected guests first
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[9px] px-1 py-0.5 rounded border border-theme-stroke text-theme-text-muted hover:text-theme-text transition-colors"
            title="Override with a custom value"
          >
            Override
          </button>
          {renderAppealAffordance()}
          {historyOpen && (
            <AppealHistoryModal partyId={event.id} onClose={() => setHistoryOpen(false)} />
          )}
        </div>
      );
    }
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
        {renderAppealAffordance()}
        {historyOpen && (
          <AppealHistoryModal partyId={event.id} onClose={() => setHistoryOpen(false)} />
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
      {renderAppealAffordance()}
      {historyOpen && (
        <AppealHistoryModal partyId={event.id} onClose={() => setHistoryOpen(false)} />
      )}
    </div>
  );
};
