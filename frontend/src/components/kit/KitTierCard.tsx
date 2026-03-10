import React from 'react';
import { Check, Gift, Package, Star } from 'lucide-react';
import { KitTierInfo, KitTier } from '../../types';

interface KitTierCardProps {
  tier: KitTierInfo;
  selected: boolean;
  onSelect: (tierId: KitTier) => void;
  disabled?: boolean;
}

export const KitTierCard: React.FC<KitTierCardProps> = ({
  tier,
  selected,
  onSelect,
  disabled = false,
}) => {
  const getIcon = () => {
    switch (tier.id) {
      case 'basic':
        return <Gift size={24} />;
      case 'large':
        return <Package size={24} />;
      case 'deluxe':
        return <Star size={24} />;
      default:
        return <Gift size={24} />;
    }
  };

  return (
    <button
      type="button"
      onClick={() => !disabled && onSelect(tier.id)}
      disabled={disabled}
      className={`
        w-full text-left p-4 rounded-xl border-2 transition-all
        ${selected
          ? 'border-[#ff393a] bg-[#ff393a]/10'
          : 'border-theme-stroke bg-theme-surface hover:border-theme-stroke-hover hover:bg-theme-surface-hover'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${selected ? 'bg-[#ff393a]/20 text-[#ff393a]' : 'bg-theme-surface-hover text-theme-text-secondary'}`}>
          {getIcon()}
        </div>
        {selected && (
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-[#ff393a]">
            <Check size={14} className="text-theme-text" />
          </div>
        )}
      </div>

      <h3 className={`font-semibold mb-1 ${selected ? 'text-theme-text' : 'text-theme-text'}`}>
        {tier.name}
      </h3>
      <p className="text-sm text-theme-text-muted mb-3">
        {tier.description}
      </p>

      <div className="space-y-1.5">
        {tier.contents.map((item, index) => (
          <div key={index} className="flex items-center gap-2 text-sm">
            <Check size={14} className={selected ? 'text-[#ff393a]' : 'text-theme-text-muted'} />
            <span className={selected ? 'text-theme-text' : 'text-theme-text-secondary'}>{item}</span>
          </div>
        ))}
      </div>
    </button>
  );
};
