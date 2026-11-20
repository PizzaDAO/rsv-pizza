import React from 'react';
import { useTranslation } from 'react-i18next';
import { EVENT_LABEL_ICONS, EVENT_LABEL_KEYS, MAX_EVENT_LABELS, knownLabels, type EventLabelKey } from '../lib/eventLabels';

interface Props {
  value: readonly string[] | null | undefined;
  onChange: (next: EventLabelKey[]) => void;
  disabled?: boolean;
}

/** Host editor: toggle chips for the curated public tags, max MAX_EVENT_LABELS. */
export const EventLabelPicker: React.FC<Props> = ({ value, onChange, disabled }) => {
  const { t } = useTranslation('event');
  const selected = knownLabels(value);
  const atMax = selected.length >= MAX_EVENT_LABELS;

  const toggle = (key: EventLabelKey) => {
    if (selected.includes(key)) {
      onChange(selected.filter((k) => k !== key));
    } else if (!atMax) {
      onChange(knownLabels([...selected, key]));
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('labels.title')}>
        {EVENT_LABEL_KEYS.map((key) => {
          const on = selected.includes(key);
          const Icon = EVENT_LABEL_ICONS[key];
          const blocked = disabled || (!on && atMax);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              disabled={blocked}
              onClick={() => toggle(key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                on
                  ? 'border-[#ff393a] bg-theme-surface-hover text-theme-text'
                  : 'border-theme-stroke bg-theme-surface text-theme-text-secondary hover:border-[#ff393a] hover:text-theme-text'
              } ${blocked && !on ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <Icon size={12} className="shrink-0" aria-hidden="true" />
              {t(`labels.keys.${key}`)}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-white/40 mt-1.5">
        {atMax ? t('labels.maxReached', { max: MAX_EVENT_LABELS }) : t('labels.helper', { max: MAX_EVENT_LABELS })}
      </p>
    </div>
  );
};
