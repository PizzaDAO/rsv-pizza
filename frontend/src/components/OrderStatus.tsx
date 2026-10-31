import React, { useEffect, useState } from 'react';
import { Loader2, ExternalLink, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { getPizzaOrder, PizzaOrderView, statusInfo, isTerminalStatus, formatCents } from '../lib/pizzaOrder';

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

export const OrderStatus: React.FC<OrderStatusProps> = ({ partyId, order, orderScript, onUpdate, onDone }) => {
  const [stale, setStale] = useState(false);
  const [copied, setCopied] = useState(false);

  // The webhook updates the server row; this fallback poll keeps the page current.
  useEffect(() => {
    if (isTerminalStatus(order.status) || !order.isMine) return;
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
  }, [partyId, order.opopOrderId, order.status, order.isMine, onUpdate]);

  const info = statusInfo(order);
  const waiting = !isTerminalStatus(order.status);
  const url = order.nextAction?.type === 'open_url' ? order.nextAction.url : null;
  const deferred = order.call?.deferred_calls ?? [];
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
        {deferred.length > 0 && (
          <div className="mt-2 text-xs text-theme-text-secondary">
            <p className="font-medium">Calls scheduled for later</p>
            <ul className="list-disc list-inside">
              {deferred.map((d, i) => (
                <li key={i}>{[d.at && new Date(d.at).toLocaleString(), d.reason].filter(Boolean).join(': ')}</li>
              ))}
            </ul>
          </div>
        )}
        {stale && <p className="text-xs text-theme-text-faint mt-2">Having trouble refreshing. Showing the last known status.</p>}
        {!order.isMine && <p className="text-xs text-theme-text-faint mt-2">Placed by another host of this party.</p>}
      </div>

      {url && order.isMine && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="btn-primary w-full text-sm py-2 flex items-center justify-center gap-2">
          <ExternalLink size={14} />
          {order.status === 'awaiting_price_approval' ? 'Review the higher price' : order.status === 'held' ? 'Pay now' : 'Open the approval page'}
        </a>
      )}

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

      {!waiting && (
        <button type="button" onClick={onDone} className="text-xs text-theme-text-muted hover:text-theme-text">
          {order.status === 'confirmed_by_shop' ? 'Done' : 'Order from another pizzeria'}
        </button>
      )}
    </div>
  );
};
