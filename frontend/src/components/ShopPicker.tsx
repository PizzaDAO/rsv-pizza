import React, { useEffect, useState } from 'react';
import { Loader2, Phone, MapPin, Bot, Zap, ExternalLink } from 'lucide-react';
import { getPizzaShops, shopBadge, PizzaShop } from '../lib/pizzaOrder';

interface ShopPickerProps {
  partyId: string;
  onSelect: (shop: PizzaShop) => void;
  preferName?: string;
}

const toneClass: Record<'green' | 'purple' | 'gray', string> = {
  green: 'text-[#4ade80] bg-[#4ade80]/10',
  purple: 'text-[#a78bfa] bg-[#8b5cf6]/10',
  gray: 'text-theme-text-muted bg-theme-surface-hover',
};

const addressLine = (a: Record<string, unknown>) =>
  [a.line1, a.city, a.region].filter((x) => typeof x === 'string' && x).join(', ');

export const ShopPicker: React.FC<ShopPickerProps> = ({ partyId, onSelect, preferName }) => {
  const [shops, setShops] = useState<PizzaShop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attribution, setAttribution] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPizzaShops(partyId)
      .then((r) => {
        if (cancelled) return;
        const want = preferName?.trim().toLowerCase();
        const sorted = want
          ? [...r.pizzerias].sort((a, b) => Number(b.name.toLowerCase().includes(want)) - Number(a.name.toLowerCase().includes(want)))
          : r.pizzerias;
        setShops(sorted);
        setAttribution(r.pizzerias.find((s) => s.attribution)?.attribution ?? null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load pizzerias'));
    return () => {
      cancelled = true;
    };
  }, [partyId, preferName]);

  if (error) return <p className="text-sm text-[#ff393a]">{error}</p>;
  if (!shops) {
    return (
      <div className="flex items-center gap-2 text-sm text-theme-text-muted py-4">
        <Loader2 size={16} className="animate-spin" /> Finding pizzerias near the venue...
      </div>
    );
  }
  if (shops.length === 0) {
    return <p className="text-sm text-theme-text-muted">No pizzerias found near this party. Add a venue address first.</p>;
  }

  return (
    <div className="space-y-2">
      {shops.map((shop) => {
        const badge = shopBadge(shop);
        const Icon = badge.tone === 'green' ? Zap : badge.tone === 'purple' ? Bot : Phone;
        return (
          <div key={shop.id} className="p-3 bg-theme-surface rounded-xl border border-theme-stroke">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-theme-text text-sm truncate">{shop.name}</p>
                <p className="text-xs text-theme-text-muted flex items-center gap-1 truncate">
                  <MapPin size={11} className="flex-shrink-0" />
                  {addressLine(shop.address) || 'Address unavailable'}
                  {shop.distance_km != null && ` · ${(shop.distance_km * 0.621371).toFixed(1)} mi`}
                </p>
                <span className={`inline-flex items-center gap-1 mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${toneClass[badge.tone]}`}>
                  <Icon size={11} /> {badge.label}
                </span>
              </div>
              {badge.orderable ? (
                <button type="button" onClick={() => onSelect(shop)} className="btn-primary text-sm py-1.5 px-3 flex-shrink-0">
                  Order
                </button>
              ) : (
                <div className="flex flex-col items-end gap-1 flex-shrink-0 text-xs">
                  {shop.phone && (
                    <a href={`tel:${shop.phone}`} className="text-theme-text-secondary hover:text-theme-text flex items-center gap-1">
                      <Phone size={12} /> {shop.phone}
                    </a>
                  )}
                  {shop.website && (
                    <a href={shop.website} target="_blank" rel="noopener noreferrer" className="text-theme-text-secondary hover:text-theme-text flex items-center gap-1">
                      <ExternalLink size={12} /> Website
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {attribution && <p className="text-[11px] text-theme-text-faint">{attribution}</p>}
    </div>
  );
};
