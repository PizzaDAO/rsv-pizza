import React, { useEffect, useState } from 'react';
import { Loader2, ExternalLink, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { getPizzaOrder, cancelPizzaOrder, settlePizzaOrder, PizzaOrderView, statusInfo, isTerminalStatus, formatCents } from '../lib/pizzaOrder';

interface OrderStatusProps {
  partyId: string;
  order: PizzaOrderView;
  /** Plain-text order for the "call them yourself" fallback. */
  orderScript: string;
  onUpdate: (o: PizzaOrderView) => void;
  onDone: () => void;
}

const POLL_MS = 10_000;
const FALLBACK = ['shop_requires_prepay', 'refused', 'unreachable', 'needs_review'];
const fmtUntil = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
};

export const OrderStatus: React.FC<OrderStatusProps> = ({ partyId, order, orderScript, onUpdate, onDone }) => {
  const [stale, setStale] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);
  const settle = async (action: 'nothing_ordered' | 'receipt_uploaded') => {
    setSettleError(null);
    try {
      onUpdate((await settlePizzaOrder(partyId, order.opopOrderId, action)).order);
    } catch (e) {
      setSettleError(e instanceof Error ? e.message : 'Could not update the order');
    }
  };

  // The webhook updates the server row; this fallback poll keeps the page current.
  useEffect(() => {
    if ((isTerminalStatus(order.status) && !order.settling) || order.restartable || !order.isMine) return;
    let stop = false;
    const tick = async () => {
      if (stop || document.hidden) return;
      try {
        const r = await getPizzaOrder(partyId, order.opopOrderId);
        if (stop) return;
        setStale(r.stale);
        onUpdate(r.order);
      } catch {
        if (!stop) setStale(true);
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    const onVisible = () => !document.hidden && tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [partyId, order.opopOrderId, order.status, order.restartable, order.settling, order.isMine, onUpdate]);

  const info = statusInfo(order);
  const waiting = !isTerminalStatus(order.status) && !order.restartable;
  const url = order.nextAction?.type === 'open_url' ? order.nextAction.url : null;
  const deferred = order.call?.deferred ?? null;
  const Icon = info.tone === 'success' ? CheckCircle2 : info.tone === 'warn' || info.tone === 'error' ? AlertTriangle : waiting ? Loader2 : Clock;
  const color = info.tone === 'success' ? 'text-[#4ade80]' : info.tone === 'warn' || info.tone === 'error' ? 'text-[#ffb347]' : 'text-theme-text';

  return (
    <div className="space-y-3">
      <div className="p-3 bg-theme-surface rounded-xl border border-theme-stroke">
        <div className="flex items-start gap-2">
          <Icon size={18} className={`${color} flex-shrink-0 mt-0.5 ${waiting && info.tone === 'info' ? 'animate-spin' : ''}`} />
          <div className="min-w-0">
            <p className={`text-sm font-medium ${color}`}>{info.title}</p>
            {info.detail && <p className="text-xs text-theme-text-secondary mt-0.5">{info.detail}</p>}
          </div>
        </div>
        {order.ceilingCents != null && order.tier === 'listing' && (
          <p className="text-xs text-theme-text-faint mt-2">You approved up to {formatCents(order.ceilingCents)}.</p>
        )}
        {order.call?.changes && order.call.changes.length > 0 && (
          <ul className="mt-2 list-disc list-inside text-xs text-theme-text-secondary">
            {order.call.changes.map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}
        {deferred && (deferred.message || deferred.until) && (
          <p className="mt-2 text-xs text-theme-text-secondary">
            {deferred.message || `We will call ${order.shopName} later.`}
            {fmtUntil(deferred.until) && <> Next try: {fmtUntil(deferred.until)}.</>}
          </p>
        )}
        {stale && <p className="text-xs text-theme-text-faint mt-2">Having trouble refreshing. Showing the last known status.</p>}
        {order.status === 'confirmed_by_shop' && (
          <p className="text-xs text-theme-text-faint mt-2">
            A reminder line with this total is on your Receipts list. It is not counted as a receipt: upload the real one.
          </p>
        )}
        {!order.isMine && <p className="text-xs text-theme-text-faint mt-2">Placed by another host of this party.</p>}
      </div>

      {url && order.isMine && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="btn-primary w-full text-sm py-2 flex items-center justify-center gap-2">
          <ExternalLink size={14} />
          {order.status === 'awaiting_price_approval' ? 'Review the higher price' : order.status === 'held' ? 'Pay now' : 'Open the approval page'}
        </a>
      )}

      {order.isMine && order.cancelable && (
        <div>
          <button
            type="button"
            className="btn-secondary w-full text-sm py-1.5"
            disabled={canceling}
            onClick={async () => {
              if (!window.confirm(`Cancel the order at ${order.shopName}?`)) return;
              setCanceling(true);
              setCancelError(null);
              try {
                onUpdate((await cancelPizzaOrder(partyId, order.opopOrderId)).order);
              } catch (e) {
                setCancelError(e instanceof Error ? e.message : 'Could not cancel');
              } finally {
                setCanceling(false);
              }
            }}
          >
            {canceling ? 'Canceling...' : 'Cancel this order'}
          </button>
          {cancelError && <p className="text-xs text-[#ff393a] mt-1">{cancelError}</p>}
        </div>
      )}

      {order.releasable && (
        <button type="button" className="btn-secondary w-full text-sm py-1.5" onClick={() => settle('nothing_ordered')}>
          Nothing was ordered: release it
        </button>
      )}
      {order.status === 'confirmed_by_shop' && !order.receiptCovered && (
        <button type="button" className="text-xs text-theme-text-muted hover:text-theme-text underline" onClick={() => settle('receipt_uploaded')}>
          I uploaded the receipt
        </button>
      )}
      {settleError && <p className="text-xs text-[#ff393a]">{settleError}</p>}

      {FALLBACK.includes(order.status) && orderScript && (
        <div className="p-3 bg-theme-surface rounded-xl border border-theme-stroke space-y-2">
          <p className="text-xs uppercase tracking-wide text-theme-text-muted">Order to read out</p>
          <pre className="text-xs text-theme-text whitespace-pre-wrap font-sans">{orderScript}</pre>
          <button
            type="button"
            className="btn-secondary text-xs py-1 px-3"
            onClick={() => navigator.clipboard?.writeText(orderScript).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => undefined)}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      {(!waiting || order.restartable) && (
        <button type="button" onClick={onDone} className="text-xs text-theme-text-muted hover:text-theme-text">
          {order.status === 'confirmed_by_shop' ? 'Done' : order.restartable ? 'Start over' : 'Order from another pizzeria'}
        </button>
      )}
    </div>
  );
};
