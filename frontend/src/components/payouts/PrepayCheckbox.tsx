import React, { useState } from 'react';
import { Checkbox } from '../Checkbox';
import { updatePartyApi } from '../../lib/api';
import { usePizza } from '../../contexts/PizzaContext';

interface PrepayCheckboxProps {
  partyId: string;
}

/**
 * arugula-38633 v2 follow-up: event-level "I need 50% prepayment" checkbox,
 * surfaced at the top of the Payments tab so the host can flag/unflag
 * regardless of whether they're in the list or new-payment view.
 *
 * Checking adds `'prepay'`, unchecking removes it. Admins can also add/remove
 * the tag via /underboss.
 *
 * scam-flag-private: writes are a targeted `PATCH { prepay }` (the backend
 * toggles only 'prepay' on the STORED tags), never the full tag array — for
 * payment admins the backend writes a full array as sent, so a stripped
 * public list would wipe 'possible-scam' / 'paid' / 'go' / caps. The control
 * is hidden unless the raw tags were loaded (otherwise its checked state is
 * unknown).
 */
export const PrepayCheckbox: React.FC<PrepayCheckboxProps> = ({ partyId }) => {
  const { party, setParty } = usePizza();
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
    try {
      await updatePartyApi(partyId, { prepay: next });
      const current = Array.isArray(party?.eventTags) ? party!.eventTags : [];
      const nextTags = next
        ? Array.from(new Set([...current, 'prepay']))
        : current.filter(t => t !== 'prepay');
      // Optimistic context patch: update the cached party in-place so a
      // remount (e.g. after tab switch) reads fresh eventTags without a
      // network refresh. No loadParty() — that triggered a delayed re-render
      // that felt like a page reload.
      setParty(prev => (prev ? { ...prev, eventTags: nextTags } : prev));
    } catch {
      // Revert optimistic on failure
      setOptimistic(isChecked);
    } finally {
      setSaving(false);
    }
  };

  if (!party?.rawEventTagsLoaded) return null;

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
