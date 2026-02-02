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
          : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${selected ? 'bg-[#ff393a]/20 text-[#ff393a]' : 'bg-white/10 text-white/60'}`}>
          {getIcon()}
        </div>
        {selected && (
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-[#ff393a]">
            <Check size={14} className="text-white" />
          </div>
        )}
      </div>

      <h3 className={`font-semibold mb-1 ${selected ? 'text-white' : 'text-white/80'}`}>
        {tier.name}
      </h3>
      <p className="text-sm text-white/50 mb-3">
        {tier.description}
      </p>

      <div className="space-y-1.5">
        {tier.contents.map((item, index) => (
          <div key={index} className="flex items-center gap-2 text-sm">
            <Check size={14} className={selected ? 'text-[#ff393a]' : 'text-white/40'} />
            <span className={selected ? 'text-white/90' : 'text-white/60'}>{item}</span>
          </div>
        ))}
      </div>
    </button>
  );
};
