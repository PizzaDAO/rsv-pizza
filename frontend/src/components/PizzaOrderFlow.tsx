import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { usePizza } from '../contexts/PizzaContext';
import { ShopPicker } from './ShopPicker';
import { CartReview } from './CartReview';
import { OrderStatus } from './OrderStatus';
import {
  buildPizzaCart, getPizzaOrderConfig, getPizzaOrders, placePizzaOrder,
  CartResponse, PizzaOrderView, PizzaShop, isTerminalStatus,
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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!partyId) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getPizzaOrderConfig(partyId);
        if (cancelled) return;
        setEnabled(cfg.enabled);
        if (!cfg.enabled) return;
        // resume an order that is still in flight (page reload while the AI is calling)
        const { orders } = await getPizzaOrders(partyId).catch(() => ({ orders: [] as PizzaOrderView[] }));
        if (cancelled) return;
        const live = orders.find((o) => o.isMine && !isTerminalStatus(o.status));
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
    async (pickupAtIso: string) => {
      if (!partyId || !shop) return;
      setBuilding(true);
      setError(null);
      try {
        setCartState(await buildPizzaCart(partyId, shop.id, recommendations, pickupAtIso));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not build the order');
      } finally {
        setBuilding(false);
      }
    },
    [partyId, shop, recommendations]
  );

  const onApprove = useCallback(
    async (input: { ceilingCents: number; substitution: 'exact' | 'deals_ok'; contact: { name: string; phone: string } }) => {
      if (!partyId || !shop || !cartState?.cart || !cartState.quote) return;
      setPlacing(true);
      setError(null);
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
          attempt,
        });
        const url = r.next_action?.type === 'open_url' ? r.next_action.url : null;
        if (tab && url) tab.location.href = url;
        else tab?.close();
        setOrder(r.order);
        setStep('status');
      } catch (e) {
        tab?.close();
        setError(e instanceof Error ? e.message : 'Could not place the order');
      } finally {
        setPlacing(false);
      }
    },
    [partyId, shop, cartState, attempt]
  );

  if (!partyId || enabled === false) return <>{fallback}</>;

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

      {step === 'cart' && shop && (
        <CartReview
          shop={shop}
          cartState={cartState}
          building={building}
          error={error}
          defaultName={party?.hostName || ''}
          partyDate={party?.date ?? null}
          onBuild={onBuild}
          onApprove={onApprove}
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
            // a new order after a failed one is a fresh idempotency key
            if (order.status !== 'confirmed_by_shop') setAttempt((a) => a + 1);
            setOrder(null);
            setCartState(null);
            setStep('shops');
          }}
        />
      )}
    </div>
  );
};
