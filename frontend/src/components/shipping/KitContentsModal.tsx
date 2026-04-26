import React from 'react';
import { createPortal } from 'react-dom';
import { X, Gift, Package, Star, Check } from 'lucide-react';
import { KIT_TIERS } from '../../types';
import type { KitTier } from '../../types';

interface KitContentsModalProps {
  tier: KitTier;
  onClose: () => void;
}

const TIER_ICONS: Record<string, React.ReactNode> = {
  basic: <Gift size={18} />,
  large: <Package size={18} />,
  deluxe: <Star size={18} />,
};

export function KitContentsModal({ tier, onClose }: KitContentsModalProps) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-theme-card border border-theme-stroke rounded-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-theme-stroke">
          <h3 className="text-lg font-semibold text-theme-text">Kit Tiers</h3>
          <button
            onClick={onClose}
            className="text-theme-text-faint hover:text-theme-text-secondary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tier list */}
        <div className="p-5 space-y-3">
          {KIT_TIERS.map((t) => {
            const isActive = t.id === tier;
            return (
              <div
                key={t.id}
                className={`rounded-xl p-4 transition-colors ${
                  isActive
                    ? 'bg-[#ff393a]/10 border border-[#ff393a]/30'
                    : 'bg-theme-surface border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={isActive ? 'text-[#ff393a]' : 'text-theme-text-muted'}>
                    {TIER_ICONS[t.id]}
                  </span>
                  <span className="text-sm font-medium text-theme-text">{t.name}</span>
                  {isActive && (
                    <span className="ml-auto text-xs font-medium text-[#ff393a] bg-[#ff393a]/15 px-2 py-0.5 rounded-full">
                      Current
                    </span>
                  )}
                </div>
                <p className="text-xs text-theme-text-muted mb-2">{t.description}</p>
                <div className="flex flex-wrap gap-1">
                  {t.contents.map((item, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1 text-xs bg-theme-surface-hover text-theme-text-secondary px-2 py-0.5 rounded"
                    >
                      <Check size={10} className="text-[#ff393a]" />
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
