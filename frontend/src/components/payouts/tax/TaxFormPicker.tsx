import React from 'react';
import { Flag, Globe, Building2 } from 'lucide-react';
import { TaxFormType } from '../../../types';

interface TaxFormPickerProps {
  value: TaxFormType | null;
  onChange: (formType: TaxFormType) => void;
  disabled?: boolean;
}

interface CardSpec {
  type: TaxFormType;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  desc: string;
}

const CARDS: CardSpec[] = [
  {
    type: 'w9',
    icon: Flag,
    title: 'US individual or business (W-9)',
    desc: 'Use this if you live in the US or your business is registered in the US.',
  },
  {
    type: 'w8ben',
    icon: Globe,
    title: 'Individual outside the US (W-8BEN)',
    desc: 'Use this if you are a non-US individual.',
  },
  {
    type: 'w8bene',
    icon: Building2,
    title: 'Organization outside the US (W-8BEN-E)',
    desc: 'Use this if your organization is registered outside the US.',
  },
];

/**
 * salame-92110: 3-card picker for the host's tax-form type. The host picks
 * one explicitly — we don't auto-infer US vs foreign from User.country /
 * Party.country in phase 1 to keep the cohost-shared-party flow simple.
 */
export const TaxFormPicker: React.FC<TaxFormPickerProps> = ({ value, onChange, disabled }) => {
  return (
    <div className="space-y-3">
      {CARDS.map((card) => {
        const Icon = card.icon;
        const active = value === card.type;
        return (
          <button
            key={card.type}
            type="button"
            disabled={disabled}
            onClick={() => onChange(card.type)}
            className={[
              'w-full text-left rounded-xl border p-4 transition-colors',
              'flex items-start gap-3',
              active
                ? 'border-[#ff393a] bg-[#ff393a]/10'
                : 'border-theme-stroke hover:border-theme-text-muted',
              disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
          >
            <Icon size={20} className={active ? 'text-[#ff393a]' : 'text-theme-text-muted'} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-theme-text">{card.title}</div>
              <div className="text-xs text-theme-text-muted mt-0.5">{card.desc}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
};
