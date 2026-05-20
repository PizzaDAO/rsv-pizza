import React, { useState, useEffect } from 'react';
import { Users, Check, X, Loader2, Pencil } from 'lucide-react';
import { IconInput } from '../IconInput';
import { updateParty } from '../../lib/supabase';
import { usePizza } from '../../contexts/PizzaContext';

interface ExpectedGuestsCardProps {
  partyId: string;
  expectedGuests?: number | null;
}

/**
 * arugula-38633 v2 follow-up: compact stat-card editor for the host's
 * `parties.expected_guests` value, surfaced in the Payments tab so it is
 * always accessible (not just buried in the NewPayoutForm first-time prompt).
 *
 * Reads/writes the SAME field used by:
 *  - EventForm / PartyHeader (host event-setup UI)
 *  - /underboss EventRow (underboss override)
 *  - NewPayoutForm "Estimated attendance" first-time prompt
 *
 * No fallback logic needed — single source of truth.
 */
export const ExpectedGuestsCard: React.FC<ExpectedGuestsCardProps> = ({
  partyId,
  expectedGuests,
}) => {
  const { party, loadParty, guests } = usePizza();
  const rsvpCount = guests?.length ?? 0;
  // Edit mode is implicit when the value is null (no value yet → show input).
  // For non-null, the host clicks Edit to reveal the input.
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(
    expectedGuests != null ? String(expectedGuests) : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep local input synced if the prop changes (e.g. underboss updated it
  // mid-session, or NewPayoutForm wrote it). Only sync when NOT actively
  // editing so we don't clobber in-flight typing.
  useEffect(() => {
    if (!editing) {
      setValue(expectedGuests != null ? String(expectedGuests) : '');
    }
  }, [expectedGuests, editing]);

  const hasValue = expectedGuests != null;
  const showInput = !hasValue || editing;

  const handleSave = async () => {
    const trimmed = value.trim();
    const parsed = trimmed === '' ? null : parseInt(trimmed, 10);
    if (parsed != null && (!Number.isFinite(parsed) || parsed < 1)) {
      setError('Enter a positive number');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const ok = await updateParty(partyId, { expected_guests: parsed });
      if (!ok) {
        setError('Failed to save');
        return;
      }
      // Reload party so every consumer (NewPayoutForm prompt, pizza order
      // calcs, etc.) sees the new value via PizzaContext.
      if (party?.inviteCode) {
        await loadParty(party.inviteCode);
      }
      setEditing(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setValue(expectedGuests != null ? String(expectedGuests) : '');
    setError(null);
    setEditing(false);
  };

  return (
    <div className="card p-4">
      <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-theme-surface-hover flex items-center justify-center flex-shrink-0">
            <Users size={20} className="text-theme-text-muted" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-theme-text-muted">
              Expected guests
            </div>
            {hasValue && !editing ? (
              <div className="text-lg font-semibold text-theme-text leading-tight">
                {expectedGuests}
              </div>
            ) : (
              <div className="text-sm text-theme-text-muted leading-tight">
                {hasValue ? 'Update your estimate' : 'Set expected guests'}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {showInput ? (
            <>
              <div className="w-full sm:w-40">
                <IconInput
                  icon={Users}
                  type="number"
                  min={1}
                  placeholder="e.g. 50"
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  disabled={saving}
                />
              </div>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || value.trim() === ''}
                className="btn-primary inline-flex items-center gap-1 text-sm px-3 py-2 whitespace-nowrap disabled:opacity-50"
                aria-label="Save expected guests"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Save
              </button>
              {hasValue && (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={saving}
                  className="btn-secondary inline-flex items-center gap-1 text-sm px-3 py-2"
                  aria-label="Cancel"
                >
                  <X size={14} />
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="btn-secondary inline-flex items-center gap-1 text-sm px-3 py-2"
              aria-label="Edit expected guests"
            >
              <Pencil size={14} />
              Edit
            </button>
          )}
        </div>
      </div>

      {/* RSVP count hint — helps the host estimate */}
      <p className="text-xs text-theme-text-muted mt-2">
        {rsvpCount === 1 ? '1 RSVP' : `${rsvpCount} RSVPs`} so far.
      </p>

      {error && (
        <p className="text-xs text-[#ff393a] mt-2">{error}</p>
      )}
    </div>
  );
};
