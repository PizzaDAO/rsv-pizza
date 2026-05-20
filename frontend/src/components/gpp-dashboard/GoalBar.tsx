import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Target } from 'lucide-react';

interface GoalBarProps {
  value: number;
  goal: number | undefined;
  onSetGoal: (newGoal: number | null) => void;
}

/**
 * quattro-71244: inline goal-set / progress bar under a KPI tile.
 *
 * Modes:
 * - `goal === undefined`: render a "Set goal" affordance. Click toggles input mode.
 * - input mode: controlled number field. Blur commits, Enter commits, Escape cancels.
 *   Empty / 0 / NaN  → `onSetGoal(null)` (clears).
 * - `goal` is set: render a slim progress bar with percent label.
 *   Hover surfaces a tiny edit affordance to re-enter input mode.
 *
 * No confirm modal — goal-setting is reversible per project convention.
 */
export const GoalBar: React.FC<GoalBarProps> = ({ value, goal, onSetGoal }) => {
  const { t } = useTranslation('host');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(goal != null ? String(goal) : '');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Keep draft in sync when external goal changes.
  useEffect(() => {
    if (!editing) setDraft(goal != null ? String(goal) : '');
  }, [goal, editing]);

  const commit = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setEditing(false);
      return;
    }
    const trimmed = draft.trim();
    if (trimmed === '') {
      onSetGoal(null);
    } else {
      const parsed = parseInt(trimmed, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        onSetGoal(parsed);
      } else {
        onSetGoal(null);
      }
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="mt-2">
        <input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          min={0}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelledRef.current = true;
              setEditing(false);
            }
          }}
          placeholder={t('dashboard.kpis.setGoal')}
          className="w-full bg-transparent text-xs text-theme-text outline-none border-b border-theme-stroke focus:border-[#ff393a] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>
    );
  }

  if (goal == null) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-2 inline-flex items-center gap-1 text-[10px] text-theme-text-faint hover:text-theme-text-secondary transition-colors"
      >
        <Target size={10} />
        {t('dashboard.kpis.setGoal')}
      </button>
    );
  }

  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  const hit = pct >= 100;

  return (
    <div className="mt-2 group">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="w-full text-left"
        title={t('dashboard.kpis.setGoal')}
      >
        <div className="w-full h-1.5 bg-theme-surface-hover rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: hit ? '#22c55e' : '#ff393a',
            }}
          />
        </div>
        <div className="flex items-center justify-between mt-1 text-[10px]">
          <span className="text-theme-text-faint">{t('dashboard.kpis.goalLabel', { value: goal })}</span>
          <span className={hit ? 'text-green-400' : 'text-theme-text-faint group-hover:text-theme-text-muted'}>
            {hit ? t('dashboard.kpis.goalHit') : t('dashboard.kpis.percentToGoal', { percent: pct })}
          </span>
        </div>
      </button>
    </div>
  );
};
