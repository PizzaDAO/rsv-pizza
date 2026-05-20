import React, { useState } from 'react';
import { Checkbox } from '../Checkbox';
import { updateParty } from '../../lib/supabase';
import { usePizza } from '../../contexts/PizzaContext';

interface PrepayCheckboxProps {
  partyId: string;
}

/**
 * arugula-38633 v2 follow-up: event-level "I need 50% prepayment" checkbox,
 * surfaced at the top of the Payments tab so the host can flag/unflag
 * regardless of whether they're in the list or new-payment view.
 *
 * Reads/writes `parties.event_tags` directly — checking adds `'prepay'`,
 * unchecking removes it. Admins can also add/remove the tag via /underboss.
 */
export const PrepayCheckbox: React.FC<PrepayCheckboxProps> = ({ partyId }) => {
  const { party, loadParty } = usePizza();
  const isChecked = Array.isArray(party?.eventTags) && party!.eventTags.includes('prepay');
  // Optimistic local mirror so the toggle feels instant even before the
  // updateParty round-trip resolves and PizzaContext rehydrates.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const checked = optimistic ?? isChecked;
  const [saving, setSaving] = useState(false);

  const handleToggle = async () => {
    if (saving) return;
    const next = !checked;
    setOptimistic(next);
    setSaving(true);
    const current = Array.isArray(party?.eventTags) ? party!.eventTags : [];
    const nextTags = next
      ? Array.from(new Set([...current, 'prepay']))
      : current.filter(t => t !== 'prepay');
    try {
      await updateParty(partyId, { event_tags: nextTags });
      // Refresh PizzaContext so the new tag list is in the cached party object.
      // Otherwise switching tabs unmounts this component, optimistic state is
      // lost, and on remount isChecked reads from stale party.eventTags → the
      // checkmark appears unset even though the DB has it.
      // Fire-and-forget (don't await) — keeps the toggle snappy and avoids
      // the tab-click-reload UX bug we hit with the slider when awaiting.
      if (party?.inviteCode) loadParty(party.inviteCode);
    } catch {
      // Revert optimistic on failure
      setOptimistic(isChecked);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-4">
      <Checkbox
        checked={checked}
        onChange={handleToggle}
        label="I need 50% prepayment for this event"
      />
    </div>
  );
};
