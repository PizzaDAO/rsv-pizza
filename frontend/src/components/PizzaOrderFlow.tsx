import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { usePizza } from '../contexts/PizzaContext';
import { ShopPicker } from './ShopPicker';
import { CartReview } from './CartReview';
import { OrderStatus } from './OrderStatus';
import {
  buildPizzaCart, getPizzaOrderConfig, getPizzaOrders, placePizzaOrder,
  CartResponse, CartDecision, PizzaOrderView, PizzaShop, isTerminalStatus,
} from '../lib/pizzaOrder';
import { generatePhoneOrderScript } from '../lib/ordering';

type Step = 'loading' | 'shops' | 'cart' | 'status';

interface PizzaOrderFlowProps {
  /** Shown while loading fails or when this party is not in the pilot. */
  fallback: React.ReactNode;
  /** Sort a shop whose name contains this to the top (set when the host clicked Order on a pizzeria). */
  preferName?: string;
}

/**
 * basil-14648: shop picker -> cart review -> approve (on pizza-mcp's page) -> status.
 * Mounted only behind VITE_AI_ORDERING=1; the backend party allowlist decides per party.
 */
export const PizzaOrderFlow: React.FC<PizzaOrderFlowProps> = ({ fallback, preferName }) => {
  const { party, recommendations } = usePizza();
  const partyId = party?.id;
  const [step, setStep] = useState<Step>('loading');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [shop, setShop] = useState<PizzaShop | null>(null);
  const [cartState, setCartState] = useState<CartResponse | null>(null);
  const [building, setBuilding] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<PizzaOrderView | null>(null);
  const [decisions, setDecisions] = useState<Record<string, CartDecision>>({});
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  // set when the server says this party already has a live or confirmed order
  const [inProgress, setInProgress] = useState<{ existingOrderId?: string; existingStatus?: string } | null>(null);
  const [lastInput, setLastInput] = useState<Parameters<typeof placePizzaOrder>[1] | null>(null);

  useEffect(() => {
    if (!partyId) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getPizzaOrderConfig(partyId);
        if (cancelled) return;
        setEnabled(cfg.enabled);
        if (!cfg.enabled) return;
        setBlockedReason(cfg.blockedReason);
        // resume an order that is still in flight (page reload while the AI is calling)
        const { orders } = await getPizzaOrders(partyId).catch(() => ({ orders: [] as PizzaOrderView[] }));
        if (cancelled) return;
        const live = orders.find((o) => o.isMine && !isTerminalStatus(o.status) && !o.restartable);
        if (live) {
          setOrder(live);
          setStep('status');
        } else {
          setStep('shops');
        }
      } catch {
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partyId]);

  const orderScript = useMemo(
    () =>
      generatePhoneOrderScript(
        recommendations.map((r) => ({
          name: r.label || r.style.name,
          description: '',
          quantity: r.quantity ?? 1,
          size: r.size.name,
          toppings: r.toppings.map((t) => t.name),
          dietaryNotes: r.dietaryRestrictions,
        })),
        party?.hostName || '',
        'pickup'
      ),
    [recommendations, party?.hostName]
  );

  const onBuild = useCallback(
    async (pickupAtIso: string, nextDecisions: Record<string, CartDecision> = {}) => {
      if (!partyId || !shop) return;
      setBuilding(true);
      setError(null);
      setInProgress(null);
      try {
        setDecisions(nextDecisions);
        setCartState(await buildPizzaCart(partyId, shop.id, recommendations, pickupAtIso, nextDecisions));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not build the order');
      } finally {
        setBuilding(false);
      }
    },
    [partyId, shop, recommendations]
  );

  const viewExisting = useCallback(async () => {
    if (!partyId) return;
    setInProgress(null);
    try {
      const { orders } = await getPizzaOrders(partyId);
      const o = orders.find((x) => !x.restartable && x.status !== 'canceled' && x.status !== 'refused' && x.status !== 'unreachable');
      if (o) {
        setOrder(o);
        setStep('status');
      }
    } catch {
      setError('Could not load the existing order.');
    }
  }, [partyId]);

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
      setError(null);
      setInProgress(null);
      // Open the tab synchronously inside the click so popup blockers allow it, then point it at the approval page.
      const tab = window.open('', '_blank');
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
        const url = r.next_action?.type === 'open_url' ? r.next_action.url : null;
        if (tab && url) tab.location.href = url;
        else tab?.close();
        setOrder(r.order);
        setStep('status');
      } catch (e) {
        tab?.close();
        const err = e as Error & { code?: string; data?: { existingOrderId?: string; existingStatus?: string } };
        if (err.code === 'ORDER_IN_PROGRESS') {
          // never silently place a second order: the host chooses
          setInProgress({ existingOrderId: err.data?.existingOrderId, existingStatus: err.data?.existingStatus });
          setLastInput(input as never);
        } else {
          setError(err instanceof Error ? err.message : 'Could not place the order');
        }
      } finally {
        setPlacing(false);
      }
    },
    [partyId, shop, cartState]
  );

  // until the backend says this party is in the pilot, show only the normal notice (no flash of the flow)
  if (!partyId || enabled !== true) return <>{fallback}</>;

  return (
    <div className="mt-4 mb-4 p-4 bg-theme-surface border border-theme-stroke rounded-xl">
      <div className="flex items-center gap-2 mb-3">
        <Bot size={18} className="text-[#a78bfa]" />
        <h3 className="font-medium text-theme-text text-sm">AI Ordering</h3>
        <span className="text-[10px] font-semibold text-[#a78bfa] bg-[#8b5cf6]/10 px-2 py-0.5 rounded-full">Pilot</span>
      </div>

      {step === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-theme-text-muted py-4">
          <Loader2 size={16} className="animate-spin" /> Loading...
        </div>
      )}

      {step === 'shops' && (
        <ShopPicker
          partyId={partyId}
          preferName={preferName}
          onSelect={(s) => {
            setShop(s);
            setCartState(null);
            setError(null);
            setStep('cart');
          }}
        />
      )}

      {blockedReason && step !== 'status' && (
        <p className="text-sm text-[#ffb347] mb-3">
          {blockedReason === 'NO_REIMBURSEMENT_CAP'
            ? 'AI ordering needs a reimbursement cap on this party. Ask your underboss to set one.'
            : blockedReason === 'CAP_EXHAUSTED'
              ? 'No reimbursement budget is left for another order.'
              : 'AI ordering is not available for this party right now.'}
        </p>
      )}

      {inProgress && (
        <div className="p-3 mb-3 rounded-xl border border-[#ffb347]/40 bg-[#ffb347]/5 space-y-2">
          <p className="text-sm text-theme-text">This party already has an order in progress or confirmed.</p>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary text-xs py-1 px-3" onClick={viewExisting}>
              View it
            </button>
            <button type="button" className="btn-secondary text-xs py-1 px-3" disabled={placing || !lastInput} onClick={() => lastInput && onApprove(lastInput as never, true)}>
              Place a second order anyway
            </button>
          </div>
        </div>
      )}

      {step === 'cart' && shop && (
        <CartReview
          shop={shop}
          cartState={cartState}
          building={building}
          error={error}
          defaultName={party?.hostName || ''}
          partyDate={party?.date ?? null}
          onBuild={(iso) => onBuild(iso, decisions)}
          onDecide={onDecide}
          onApprove={(i) => onApprove(i)}
          placing={placing}
          onBack={() => setStep('shops')}
        />
      )}

      {step === 'status' && order && (
        <OrderStatus
          partyId={partyId}
          order={order}
          orderScript={orderScript}
          onUpdate={setOrder}
          onDone={() => {
            setOrder(null);
            setCartState(null);
            setStep('shops');
          }}
        />
      )}
    </div>
  );
};
