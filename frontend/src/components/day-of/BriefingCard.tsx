import React, { useEffect, useState } from 'react';
import { Megaphone, Check } from 'lucide-react';
import { Party } from '../../types';
import { Checkbox } from '../Checkbox';
import { PIZZADAO_BRIEFING } from '../../lib/dayOfBriefing';

interface BriefingCardProps {
  party: Party;
  /** When true (auto-promoted window), render with an accent border. */
  highlighted?: boolean;
}

/**
 * GPP-only PizzaDAO mic-announcement briefing card. Caller is responsible
 * for hiding this for non-GPP parties (see DayOfDashboard for the
 * `eventType === 'gpp'` gate). Persists "done" state in localStorage so
 * dismissing once sticks for the rest of the evening.
 */
export const BriefingCard: React.FC<BriefingCardProps> = ({ party, highlighted }) => {
  const storageKey = `dayof.briefing.done.${party.id}`;
  const [done, setDone] = useState(false);

  useEffect(() => {
    try {
      setDone(localStorage.getItem(storageKey) === '1');
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const toggle = () => {
    setDone((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div
      className={`card p-5 space-y-3 transition-opacity ${
        done ? 'opacity-50' : ''
      } ${highlighted ? 'border-2 border-[#ff393a]/60' : ''}`}
    >
      <div className="flex items-center gap-2">
        <Megaphone size={18} className="text-[#ff393a]" />
        <h3 className="text-lg font-semibold text-theme-text">
          PizzaDAO mic-announcement
        </h3>
      </div>

      <div className="text-xs text-theme-text-muted bg-[#ff393a]/10 rounded px-3 py-2">
        ~1 hour into event — then hand the mic to your partners, 1–3 min each.
      </div>

      <p className="text-lg leading-relaxed text-theme-text whitespace-pre-line">
        {PIZZADAO_BRIEFING.script}
      </p>

      <div className="pt-2 border-t border-white/10">
        <Checkbox
          checked={done}
          onChange={toggle}
          label={done ? 'Done — announcement made' : 'Mark as done'}
        >
          {done && <Check size={14} className="text-green-500" />}
        </Checkbox>
      </div>
    </div>
  );
};
