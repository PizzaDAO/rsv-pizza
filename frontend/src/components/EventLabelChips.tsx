import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { EVENT_LABEL_ICONS, knownLabels, type EventLabelKey } from '../lib/eventLabels';

interface Props {
  labels: readonly string[] | null | undefined;
  /**
   * link:   chips link to the events search filtered by that tag (relative path, so white-label
   *         builds stay on their own domain).
   * static: plain read-only chips (use inside another link, e.g. result cards).
   * select: toggle buttons for the /events filter row.
   */
  mode?: 'link' | 'static' | 'select';
  selected?: readonly string[];
  counts?: Record<string, number>;
  onToggle?: (key: EventLabelKey) => void;
  className?: string;
}

const BASE = 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs';
const IDLE = 'border-theme-stroke bg-theme-surface text-theme-text-secondary';
const HOVER = 'hover:border-[#ff393a] hover:text-theme-text transition-colors';
const ACTIVE = 'border-[#ff393a] bg-theme-surface-hover text-theme-text';

export const EventLabelChips: React.FC<Props> = ({
  labels,
  mode = 'link',
  selected = [],
  counts,
  onToggle,
  className = '',
}) => {
  const { t } = useTranslation('event');
  const keys = knownLabels(labels);
  if (keys.length === 0) return null;

  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`} data-testid="event-labels">
      {keys.map((key) => {
        const Icon = EVENT_LABEL_ICONS[key];
        const text = t(`labels.keys.${key}`);
        const inner = (
          <>
            <Icon size={12} className="shrink-0" aria-hidden="true" />
            <span>{text}</span>
            {counts && counts[key] !== undefined && <span className="text-theme-text-muted">{counts[key]}</span>}
          </>
        );
        return (
          <li key={key}>
            {mode === 'select' ? (
              <button
                type="button"
                aria-pressed={selected.includes(key)}
                onClick={() => onToggle?.(key)}
                className={`${BASE} ${selected.includes(key) ? ACTIVE : `${IDLE} ${HOVER}`}`}
              >
                {inner}
              </button>
            ) : mode === 'link' ? (
              <Link to={`/events?tags=${encodeURIComponent(key)}`} className={`${BASE} ${IDLE} ${HOVER}`}>
                {inner}
              </Link>
            ) : (
              <span className={`${BASE} ${IDLE}`}>{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
};
