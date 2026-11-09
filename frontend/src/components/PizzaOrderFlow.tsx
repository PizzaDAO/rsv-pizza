import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Loader2, Phone, RotateCw } from 'lucide-react';
import { usePizza } from '../contexts/PizzaContext';
import { ShopPicker } from './ShopPicker';
import { CartReview } from './CartReview';
import { OrderStatus } from './OrderStatus';
import { InlineConfirm } from './InlineConfirm';
import {
  buildPizzaCart, getPizzaOrder, getPizzaOrderConfig, getPizzaOrders, getPizzaShops, placePizzaOrder, orderToResume,
  isTerminalStatus, formatPhone, CartResponse, CartDecision, PizzaOrderView, PizzaShop,
} from '../lib/pizzaOrder';
import { generateCheckOrderScript, generatePhoneOrderScript } from '../lib/ordering';

type Step = 'loading' | 'shops' | 'cart' | 'status';

type ApiError = Error & { code?: string; data?: { existingOrderId?: string; existingStatus?: string } };

interface PizzaOrderFlowProps {
  /** Shown when this party is not in the pilot (and, unless `gated`, while that is being checked). */
  fallback: React.ReactNode;
  /** Sort a shop whose name contains this to the top (set when the host clicked Order on a pizzeria). */
  preferName?: string;
  /**
   * The parent already knows this party is in the pilot (usePizzaOrderingEnabled): show a spinner while loading
   * and a retry on a load error instead of the fallback ("not available" was wrong while it loaded).
   */
  gated?: boolean;
}

/** An order that is still live at pizza-mcp: a second one now would race it. */
const LIVE = ['awaiting_approval', 'calling', 'awaiting_price_approval'];

/**
 * basil-14648: shop picker -> cart review -> approve (on pizza-mcp's page) -> status.
 * Mounted only behind VITE_AI_ORDERING=1; the backend party allowlist decides per party.
 */
export const PizzaOrderFlow: React.FC<PizzaOrderFlowProps> = ({ fallback, preferName, gated }) => {
  const { t } = useTranslation('host');
  const { party, recommendations } = usePizza();
  const partyId = party?.id;
  const [step, setStep] = useState<Step>('loading');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [hasLocation, setHasLocation] = useState(true);
  const [shop, setShop] = useState<PizzaShop | null>(null);
  const [cartState, setCartState] = useState<CartResponse | null>(null);
  const [building, setBuilding] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [order, setOrder] = useState<PizzaOrderView | null>(null);
  const [decisions, setDecisions] = useState<Record<string, CartDecision>>({});
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [heldOrderId, setHeldOrderId] = useState<string | null>(null);
  // set when the server names an existing order: a live or confirmed one, or (capExhausted) one that holds the budget
  const [inProgress, setInProgress] = useState<{ existingOrderId?: string; existingStatus?: string; capExhausted?: boolean; existingShop?: string } | null>(null);
  const [confirmSecond, setConfirmSecond] = useState(false);
  const [lastInput, setLastInput] = useState<Parameters<typeof placePizzaOrder>[1] | null>(null);
  // shops pizza-mcp refused to call this session (e.g. paused while an operator checks a possible opt-out)
  const [uncallable, setUncallable] = useState<ReadonlySet<string>>(() => new Set());
  const [uncallableNotice, setUncallableNotice] = useState<{ message: string; shopName: string; phone: string | null } | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  // shop phones from the listing: the Call button's fallback when the order view has no `shop.phone` (pizza-mcp
  // before 64fb2ac, or a row stored before it)
  const [phones, setPhones] = useState<ReadonlyMap<string, string>>(() => new Map());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);

  const rememberPhones = useCallback((shops: PizzaShop[]) => {
    setPhones((prev) => {
      const next = new Map(prev);
      for (const s of shops) if (s.phone) next.set(s.id, s.phone);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!partyId) return;
    let cancelled = false;
    setLoadFailed(false);
    (async () => {
      try {
        const cfg = await getPizzaOrderConfig(partyId);
        if (cancelled) return;
        setEnabled(cfg.enabled);
        if (!cfg.enabled) return;
        setBlockedReason(cfg.blockedReason);
        setHeldOrderId(cfg.heldOrderId ?? null);
        setHasLocation(!cfg.location || cfg.location.lat != null || !!cfg.location.address);
        // resume an order in flight (page reload while the AI is calling) or one a host still has to settle
        const { orders } = await getPizzaOrders(partyId).catch(() => ({ orders: [] as PizzaOrderView[] }));
        if (cancelled) return;
        const resume = orderToResume(orders);
        if (resume) {
          setOrder(resume);
          setStep('status');
        } else {
          setStep('shops');
        }
      } catch {
        if (cancelled) return;
        setEnabled(false);
        setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partyId, loadAttempt]);

  // A resumed order has no shop from this session: look its phone up in the listing once, unless pizza-mcp's order
  // view already names the number the order was placed with.
  const viewPhone = order?.shop?.phone ?? null;
  useEffect(() => {
    if (!partyId || step !== 'status' || !order || viewPhone || phones.has(order.shopId)) return;
    let cancelled = false;
    getPizzaShops(partyId)
      .then((r) => !cancelled && rememberPhones(r.pizzerias))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [partyId, step, order, viewPhone, phones, rememberPhones]);

  // Move focus to the step's heading when the step changes (not on first render), so screen readers follow.
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const scriptItems = useMemo(
    () =>
      recommendations.map((r) => ({
        name: r.label || r.style.name,
        description: '',
        quantity: r.quantity ?? 1,
        size: r.size.name,
        toppings: r.toppings.map((tp) => tp.name),
        dietaryNotes: r.dietaryRestrictions,
      })),
    [recommendations]
  );
  const orderScript = useMemo(() => generatePhoneOrderScript(scriptItems, party?.hostName || '', 'pickup'), [scriptItems, party?.hostName]);
  const checkScript = useMemo(() => generateCheckOrderScript(scriptItems, party?.hostName || ''), [scriptItems, party?.hostName]);

  /** A budget used up by an order is not a dead end: send the host to that order. */
  const showHeldOrder = useCallback((err: ApiError) => {
    if (err.code !== 'CAP_EXHAUSTED' || !err.data?.existingOrderId) return false;
    setInProgress({ ...err.data, capExhausted: true });
    return true;
  }, []);

  const onBuild = useCallback(
    async (pickupAtIso: string, nextDecisions: Record<string, CartDecision> = {}) => {
      if (!partyId || !shop) return;
      setBuilding(true);
      setError(null);
      setPlaceError(null);
      setInProgress(null);
      try {
        setDecisions(nextDecisions);
        setCartState(await buildPizzaCart(partyId, shop.id, recommendations, pickupAtIso, nextDecisions));
      } catch (e) {
        if (!showHeldOrder(e as ApiError)) setError(e instanceof Error ? e.message : t('aiOrder.flow.buildError'));
      } finally {
        setBuilding(false);
      }
    },
    [partyId, shop, recommendations, showHeldOrder, t]
  );

  const viewExisting = useCallback(
    async (orderId: string | null | undefined) => {
      if (!partyId) return;
      setInProgress(null);
      setError(null);
      try {
        if (!orderId) throw new Error('no order id');
        setOrder((await getPizzaOrder(partyId, orderId)).order);
        setStep('status');
      } catch {
        setError(t('aiOrder.flow.existingLoadError'));
      }
    },
    [partyId, t]
  );

  const onDecide = useCallback(
    (pickupAtIso: string, ref: string, choice: CartDecision) => onBuild(pickupAtIso, { ...decisions, [ref]: choice }),
    [onBuild, decisions]
  );

  const onApprove = useCallback(
    async (
      input: { ceilingCents?: number; substitution: 'exact' | 'deals_ok'; contact: { name: string; phone: string } },
      allowAnother = false
    ) => {
      if (!partyId || !shop || !cartState?.cart || !cartState.quote) return;
      setPlacing(true);
      setPlaceError(null);
      setInProgress(null);
      setConfirmSecond(false);
      setPopupBlocked(false);
      try {
        const r = await placePizzaOrder(partyId, {
          quoteId: cartState.quote.quote_id,
          cartId: cartState.cart.id,
          shopId: shop.id,
          recommendationVersion: cartState.recommendationVersion,
          contact: input.contact,
          policy: { ceilingCents: input.ceilingCents, substitution: input.substitution },
          ...(allowAnother ? { allowAnother: true } : {}),
        });
        // Open the approval page only once the order exists (no blank tab on an error). A blocked popup is fine:
        // the status card has an "Open the approval page" button, and we say so.
        const url = r.next_action?.type === 'open_url' ? r.next_action.url : null;
        if (url) {
          const tab = window.open(url, '_blank');
          if (tab) tab.opener = null;
          else setPopupBlocked(true);
        }
        setOrder(r.order);
        setStep('status');
      } catch (e) {
        const err = e as ApiError;
        if (showHeldOrder(err)) {
          // nothing else to do here: a second order could not fit either
        } else if (err.code === 'CALLS_NOT_AVAILABLE_HERE') {
          // nothing was ordered and nothing is pending: back to the list, this shop marked call-it-yourself
          setUncallable((prev) => new Set(prev).add(shop.id));
          setUncallableNotice({ message: err.message || t('aiOrder.flow.cantCall', { shop: shop.name }), shopName: shop.name, phone: shop.phone });
          setCartState(null);
          setStep('shops');
        } else if (err.code === 'ORDER_IN_PROGRESS') {
          // never silently place a second order: the host chooses
          const existing = { existingOrderId: err.data?.existingOrderId, existingStatus: err.data?.existingStatus };
          setInProgress(existing);
          setLastInput(input as never);
          if (existing.existingOrderId) {
            const existingId = existing.existingOrderId;
            Promise.resolve()
              .then(() => getPizzaOrder(partyId, existingId))
              .then((x) => {
                const o = x?.order;
                if (o) setInProgress((p) => (p && p.existingOrderId === existingId ? { ...p, existingShop: o.shopName, existingStatus: o.status } : p));
              })
              .catch(() => undefined);
          }
        } else {
          setPlaceError(err instanceof Error ? err.message : t('aiOrder.flow.placeError'));
        }
      } finally {
        setPlacing(false);
      }
    },
    [partyId, shop, cartState, showHeldOrder, t]
  );

  // Leaving an order may have changed the budget (a release, a receipt): refresh the notice.
  const onDone = useCallback(() => {
    setOrder(null);
    setCartState(null);
    setError(null);
    setPlaceError(null);
    setPopupBlocked(false);
    setStep('shops');
    if (!partyId) return;
    getPizzaOrderConfig(partyId)
      .then((cfg) => {
        setBlockedReason(cfg.blockedReason);
        setHeldOrderId(cfg.heldOrderId ?? null);
      })
      .catch(() => undefined);
  }, [partyId]);

  if (!partyId) return <>{fallback}</>;
  if (gated && enabled === null && !loadFailed) {
    return (
      <div role="status" className="ai-order flex items-center gap-2 text-sm text-theme-text-secondary p-4">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" /> {t('aiOrder.flow.loading')}
      </div>
    );
  }
  if (gated && loadFailed) {
    return (
      <div role="alert" className="ai-order space-y-2 p-4">
        <p className="text-sm text-theme-text">{t('aiOrder.flow.loadFailed')}</p>
        <button type="button" className="btn-secondary text-sm min-h-[44px] py-2 px-4 inline-flex items-center gap-2" onClick={() => setLoadAttempt((n) => n + 1)}>
          <RotateCw size={14} aria-hidden="true" /> {t('aiOrder.tryAgain')}
        </button>
      </div>
    );
  }
  // until the backend says this party is in the pilot, show only the normal notice (no flash of the flow)
  if (enabled !== true) return <>{fallback}</>;

  const blockedCopy =
    blockedReason === 'NO_REIMBURSEMENT_CAP'
      ? t('aiOrder.flow.blockedNoCap')
      : blockedReason === 'CAP_EXHAUSTED'
        ? heldOrderId ? t('aiOrder.flow.blockedHeld') : t('aiOrder.flow.blockedNoBudget')
        : blockedReason ? t('aiOrder.flow.blockedOther') : null;
  const existingLive = !!inProgress?.existingStatus && LIVE.includes(inProgress.existingStatus);
  const stepHeading =
    step === 'shops' ? t('aiOrder.flow.headingShops') : step === 'cart' && shop ? t('aiOrder.flow.headingCart', { shop: shop.name }) : step === 'status' ? t('aiOrder.flow.headingStatus') : t('aiOrder.flow.loading');

  const inProgressPanel = inProgress && (
    <div role="alert" className="p-3 rounded-xl border border-theme-stroke border-l-4 border-l-[color:var(--ai-warn)] bg-theme-surface space-y-2">
      <p className="text-sm text-theme-text">
        {inProgress.capExhausted
          ? t('aiOrder.flow.heldBudget')
          : inProgress.existingStatus && isTerminalStatus(inProgress.existingStatus) && !['confirmed_by_shop', 'completed'].includes(inProgress.existingStatus)
            ? t('aiOrder.flow.earlierMayExist')
            : t('aiOrder.flow.alreadyHasOrder')}
      </p>
      <button type="button" className="btn-primary w-full text-sm min-h-[44px] py-2" onClick={() => viewExisting(inProgress.existingOrderId)}>
        {t('aiOrder.flow.viewIt')}
      </button>
      {!inProgress.capExhausted && !existingLive && shop && (
        confirmSecond ? (
          <InlineConfirm
            message={t('aiOrder.flow.confirmSecond', { shop: shop.name, existing: inProgress.existingShop || t('aiOrder.flow.firstShop') })}
            confirmLabel={t('aiOrder.flow.confirmSecondYes')}
            cancelLabel={t('aiOrder.flow.confirmSecondNo')}
            busy={placing}
            onCancel={() => setConfirmSecond(false)}
            onConfirm={() => lastInput && onApprove(lastInput as never, true)}
          />
        ) : (
          <button type="button" className="min-h-[44px] w-full text-sm text-theme-text-secondary underline hover:text-theme-text" disabled={placing || !lastInput} onClick={() => setConfirmSecond(true)}>
            {t('aiOrder.flow.placeSecond')}
          </button>
        )
      )}
    </div>
  );

  return (
    <div className="ai-order mt-4 mb-4 p-4 bg-theme-surface border border-theme-stroke rounded-xl">
      <div className="flex items-center gap-2 mb-1">
        <Bot size={18} className="text-[color:var(--ai-accent)]" aria-hidden="true" />
        <h3 className="font-semibold text-theme-text text-sm">{t('aiOrder.flow.title')}</h3>
        <span className="text-xs font-semibold text-[color:var(--ai-accent)] border border-current px-2 py-0.5 rounded-full">{t('aiOrder.flow.pilot')}</span>
      </div>
      <p className="text-xs text-theme-text-secondary mb-3">{t('aiOrder.flow.pilotExplain')}</p>
      <h4 ref={headingRef} tabIndex={-1} className="sr-only">{stepHeading}</h4>

      {step === 'loading' && (
        <div role="status" className="flex items-center gap-2 text-sm text-theme-text-secondary py-4">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> {t('aiOrder.flow.loading')}
        </div>
      )}

      {blockedCopy && step !== 'status' && (
        <div role="status" className="p-3 mb-3 rounded-xl border border-theme-stroke border-l-4 border-l-[color:var(--ai-warn)] bg-theme-surface space-y-2">
          <p className="text-sm text-theme-text">{blockedCopy}</p>
          {blockedReason === 'CAP_EXHAUSTED' && heldOrderId && !inProgress && (
            <button type="button" className="btn-secondary w-full text-sm min-h-[44px] py-2" onClick={() => viewExisting(heldOrderId)}>
              {t('aiOrder.flow.openHeld')}
            </button>
          )}
        </div>
      )}

      {uncallableNotice && step === 'shops' && (
        <div role="status" className="p-3 mb-3 rounded-xl border border-theme-stroke bg-theme-surface space-y-2">
          <p className="text-sm text-theme-text">{uncallableNotice.message}</p>
          {uncallableNotice.phone && (
            <a href={`tel:${uncallableNotice.phone}`} className="btn-secondary w-full text-sm min-h-[44px] py-2 flex items-center justify-center gap-2">
              <Phone size={14} aria-hidden="true" /> {t('aiOrder.cart.callShop', { shop: uncallableNotice.shopName, phone: formatPhone(uncallableNotice.phone) })}
            </a>
          )}
        </div>
      )}

      {error && step !== 'cart' && <p role="alert" className="text-sm text-[color:var(--ai-error)] mb-3">{error}</p>}

      {/* next to Approve once there is a quote (where the host just tapped), else at the top */}
      {!(step === 'cart' && cartState?.quote) && inProgressPanel && <div className="mb-3">{inProgressPanel}</div>}

      {step === 'shops' && (
        <ShopPicker
          partyId={partyId}
          preferName={preferName}
          uncallable={uncallable}
          orderDisabled={!!blockedReason}
          hasLocation={hasLocation}
          onLoaded={rememberPhones}
          onSelect={(s) => {
            setShop(s);
            setCartState(null);
            setError(null);
            setPlaceError(null);
            setUncallableNotice(null);
            setStep('cart');
          }}
        />
      )}

      {step === 'cart' && shop && (
        <CartReview
          shop={shop}
          cartState={cartState}
          building={building}
          error={error}
          approveError={placeError}
          approveNotice={cartState?.quote ? inProgressPanel || null : null}
          defaultName={party?.hostName || ''}
          partyDate={party?.date ?? null}
          timeZone={party?.timezone ?? null}
          city={party?.city ?? null}
          onBuild={(iso) => onBuild(iso, decisions)}
          onDecide={onDecide}
          onApprove={(i) => onApprove(i)}
          placing={placing}
          onBack={() => setStep('shops')}
        />
      )}

      {step === 'status' && order && (
        <>
          {popupBlocked && <p role="status" className="text-sm text-theme-text mb-3">{t('aiOrder.flow.popupBlocked')}</p>}
          <OrderStatus
            partyId={partyId}
            order={order}
            orderScript={orderScript}
            checkScript={checkScript}
            shopPhone={phones.get(order.shopId) ?? (shop?.id === order.shopId ? shop.phone : null)}
            timeZone={party?.timezone ?? null}
            onUpdate={setOrder}
            onDone={onDone}
          />
        </>
      )}
    </div>
  );
};
