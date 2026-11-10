import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Phone, MapPin, Bot, Zap, ExternalLink, RotateCw, ListChecks, ShoppingBag, BookOpen } from 'lucide-react';
import { getPizzaShops, shopBadge, formatPhone, orderingLinks, safeHref, OrderingLink, PizzaShop } from '../lib/pizzaOrder';

interface ShopPickerProps {
  partyId: string;
  onSelect: (shop: PizzaShop) => void;
  preferName?: string;
  /** Shops the ordering service refused to call this session: shown as call-it-yourself. */
  uncallable?: ReadonlySet<string>;
  /** Ordering is blocked for this party right now (the reason is shown above the list): Order is disabled. */
  orderDisabled?: boolean;
  /** False when the party has no venue location: the empty list then says to add one. */
  hasLocation?: boolean;
  /** The loaded list, so the flow knows each shop's phone. */
  onLoaded?: (shops: PizzaShop[]) => void;
  /** basil-14648 P2: build a checklist to order from this shop yourself (online or by phone). */
  onChecklist?: (shop: PizzaShop) => void;
  /** basil-14648 P2: the host opened one of the shop's ordering pages (recorded; never blocks the new tab). */
  onOpenLink?: (shop: PizzaShop, link: OrderingLink) => void;
  /** basil-14648 P2: open the shop with "Use this shop's real menu" (listing shops; only when host menus are on). */
  onUseMenu?: (shop: PizzaShop) => void;
}

const toneClass: Record<'green' | 'purple' | 'gray', string> = {
  green: 'text-[color:var(--ai-success)] bg-theme-surface-hover',
  purple: 'text-[color:var(--ai-accent)] bg-theme-surface-hover',
  gray: 'text-theme-text bg-theme-surface-hover',
};

const addressLine = (a: Record<string, unknown>) =>
  [a.line1, a.city, a.region].filter((x) => typeof x === 'string' && x).join(', ');

export const ShopPicker: React.FC<ShopPickerProps> = ({ partyId, onSelect, preferName, uncallable, orderDisabled, hasLocation = true, onLoaded, onChecklist, onOpenLink, onUseMenu }) => {
  const { t } = useTranslation('host');
  const [shops, setShops] = useState<PizzaShop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attribution, setAttribution] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setShops(null);
    getPizzaShops(partyId)
      .then((r) => {
        if (cancelled) return;
        const want = preferName?.trim().toLowerCase();
        const sorted = want
          ? [...r.pizzerias].sort((a, b) => Number(b.name.toLowerCase().includes(want)) - Number(a.name.toLowerCase().includes(want)))
          : r.pizzerias;
        setShops(sorted);
        onLoaded?.(sorted);
        setAttribution(r.pizzerias.find((s) => s.attribution)?.attribution ?? null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : t('aiOrder.shops.loadError')));
    return () => {
      cancelled = true;
    };
    // onLoaded/t are stable enough; refetch only on party, preference or retry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId, preferName, attempt]);

  if (error) {
    return (
      <div role="alert" className="space-y-2">
        <p className="text-sm text-[color:var(--ai-error)]">{t('aiOrder.shops.loadErrorWith', { error })}</p>
        <button type="button" className="btn-secondary text-sm min-h-[44px] py-2 px-4 inline-flex items-center gap-2" onClick={() => setAttempt((n) => n + 1)}>
          <RotateCw size={14} aria-hidden="true" /> {t('aiOrder.tryAgain')}
        </button>
      </div>
    );
  }
  if (!shops) {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-theme-text-secondary py-4">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" /> {t('aiOrder.shops.finding')}
      </div>
    );
  }
  if (shops.length === 0) {
    return <p role="status" className="text-sm text-theme-text-secondary">{hasLocation ? t('aiOrder.shops.emptyNearby') : t('aiOrder.shops.emptyNoAddress')}</p>;
  }

  return (
    <>
    <p role="status" className="sr-only">{t('aiOrder.shops.liveFound', { count: shops.length })}</p>
    <ul className="space-y-2" aria-label={t('aiOrder.shops.listLabel')}>
      {shops.map((shop) => {
        const badge = uncallable?.has(shop.id) ? { label: t('aiOrder.shops.badgeUncallable'), tone: 'gray' as const, orderable: false } : shopBadge(shop);
        const links = orderingLinks(shop);
        const providerLinks = links.filter((l) => l.provider !== 'website');
        const site = safeHref(links.find((l) => l.provider === 'website')?.url ?? shop.website ?? null);
        // a blocked party (no cap, budget used up) sees the shop's pages switched off, with the reason above the list
        const linkButtons = providerLinks.map((l) => {
          const label = t('aiOrder.handoff.orderAt', { provider: t(`aiOrder.handoff.providers.${l.provider}`) });
          if (orderDisabled) {
            return (
              <button
                key={l.url}
                type="button"
                disabled
                aria-describedby={`${shop.id}-online-blocked`}
                className="btn-secondary text-sm min-h-[44px] py-2 px-3 inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ShoppingBag size={14} aria-hidden="true" /> {label}
              </button>
            );
          }
          return (
            <a
              key={l.url}
              href={safeHref(l.url)!}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onOpenLink?.(shop, l)}
              className="btn-secondary text-sm min-h-[44px] py-2 px-3 inline-flex items-center justify-center gap-1.5"
              aria-label={`${t('aiOrder.handoff.orderAtFor', { provider: t(`aiOrder.handoff.providers.${l.provider}`), shop: shop.name })} ${t('aiOrder.handoff.newTab')}`}
            >
              <ShoppingBag size={14} aria-hidden="true" /> {label}
            </a>
          );
        });
        const blockedNote = orderDisabled && providerLinks.length > 0 && (
          <p id={`${shop.id}-online-blocked`} className="text-xs text-theme-text-secondary">{t('aiOrder.shops.onlineBlocked')}</p>
        );
        // every shop: the host can always order it themselves with a checklist
        const checklistButton = onChecklist && (
          <button
            type="button"
            onClick={() => onChecklist(shop)}
            disabled={orderDisabled}
            className="btn-secondary text-sm min-h-[44px] py-2 px-3 inline-flex items-center justify-center gap-1.5"
            aria-label={t('aiOrder.handoff.buildChecklistFor', { shop: shop.name })}
          >
            <ListChecks size={14} aria-hidden="true" /> {t('aiOrder.handoff.buildChecklist')}
          </button>
        );
        // basil-14648 P2: the host's own menu, for a closer estimate (listing shops only: a native shop has its own)
        const menuButton = onUseMenu && shop.tier === 'listing' && (
          <button
            type="button"
            onClick={() => onUseMenu(shop)}
            disabled={orderDisabled}
            className="btn-secondary text-sm min-h-[44px] py-2 px-3 inline-flex items-center justify-center gap-1.5"
            aria-label={t('aiOrder.menu.offerFor', { shop: shop.name })}
          >
            <BookOpen size={14} aria-hidden="true" /> {t('aiOrder.menu.offer')}
          </button>
        );
        const Icon = badge.tone === 'green' ? Zap : badge.tone === 'purple' ? Bot : 'handoff' in badge && badge.handoff ? ShoppingBag : Phone;
        const addr = addressLine(shop.address);
        return (
          <li key={shop.id} className="p-3 bg-theme-surface rounded-xl border border-theme-stroke">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3">
              <div className="min-w-0">
                <p className="font-medium text-theme-text text-sm break-words">{shop.name}</p>
                <p className="text-xs text-theme-text-secondary flex items-start gap-1 break-words">
                  <MapPin size={12} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    {addr || t('aiOrder.shops.noAddress')}
                    {shop.distance_km != null && <span className="whitespace-nowrap">{` · ${(shop.distance_km * 0.621371).toFixed(1)} mi`}</span>}
                  </span>
                </p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${toneClass[badge.tone]}`}>
                    <Icon size={12} aria-hidden="true" /> {'handoff' in badge && badge.handoff ? t('aiOrder.shops.badgeOnline') : badge.label}
                  </span>
                  {shop.open_now && <span className="text-xs font-medium text-[color:var(--ai-success)]">{t('aiOrder.shops.openNow')}</span>}
                </div>
              </div>
              {badge.orderable ? (
                <div className="flex flex-col gap-2 flex-shrink-0 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => onSelect(shop)}
                    disabled={orderDisabled}
                    className="btn-primary text-sm min-h-[44px] py-2 px-5 w-full sm:w-auto"
                    aria-label={t('aiOrder.shops.orderFrom', { shop: shop.name })}
                  >
                    {t('aiOrder.shops.order')}
                  </button>
                  {/* basil-14648 P2: the shop's own online ordering and a checklist, as alternatives to the AI call */}
                  {linkButtons}
                  {blockedNote}
                  {checklistButton}
                  {menuButton}
                </div>
              ) : (
                <div className="flex flex-col gap-2 flex-shrink-0 w-full sm:w-auto">
                  {linkButtons}
                  {blockedNote}
                  {shop.phone && (
                    <a href={`tel:${shop.phone}`} className="btn-secondary text-sm min-h-[44px] py-2 px-3 inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
                      <Phone size={14} aria-hidden="true" /> {formatPhone(shop.phone)}
                    </a>
                  )}
                  {providerLinks.length === 0 && site && (
                    <a
                      href={site}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        const w = links.find((l) => l.provider === 'website');
                        if (w) onOpenLink?.(shop, w);
                      }}
                      className="btn-secondary text-sm min-h-[44px] py-2 px-3 inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <ExternalLink size={14} aria-hidden="true" /> {t('aiOrder.shops.website')}
                    </a>
                  )}
                  {checklistButton}
                  {menuButton}
                </div>
              )}
            </div>
          </li>
        );
      })}
      {attribution && <li className="text-xs text-theme-text-secondary">{attribution}</li>}
    </ul>
    </>
  );
};
