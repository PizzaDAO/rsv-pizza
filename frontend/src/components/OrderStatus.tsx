import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ExternalLink, CheckCircle2, AlertTriangle, Clock, BellRing, Phone, Info } from 'lucide-react';
import {
  getPizzaOrder, cancelPizzaOrder, settlePizzaOrder, PizzaOrderView, statusInfo, isTerminalStatus, formatCents,
  formatWhen, formatPhone, approvalDeadline,
} from '../lib/pizzaOrder';
import { InlineConfirm } from './InlineConfirm';

interface OrderStatusProps {
  partyId: string;
  order: PizzaOrderView;
  /** Plain-text order for the "call them yourself" fallback, when ordering again is safe. */
  orderScript: string;
  /** What to say when an order MAY exist: asks about the earlier order instead of placing a new one. */
  checkScript?: string;
  /** The shop's phone (E.164) from the listing, for the Call button. */
  shopPhone?: string | null;
  /** The party's time zone: every time on this card is shown in it. */
  timeZone?: string | null;
  onUpdate: (o: PizzaOrderView) => void;
  onDone: () => void;
}

const POLL_MS = 10_000;
const FALLBACK = ['shop_requires_prepay', 'refused', 'unreachable', 'needs_review'];

/** "2:41 left" until the deadline, ticking every second. */
const Countdown: React.FC<{ deadline: string }> = ({ deadline }) => {
  const { t } = useTranslation('host');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, Date.parse(deadline) - now);
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  return (
    <p className="mt-2 text-sm font-semibold text-[color:var(--ai-warn)] tabular-nums" aria-live="off">
      <Clock size={14} className="inline mr-1 -mt-0.5" />
      {left > 0 ? t('aiOrder.status.timeLeft', { time: `${mm}:${String(ss).padStart(2, '0')}` }) : t('aiOrder.status.timeUp')}
    </p>
  );
};

type Pending = 'cancel' | 'release' | null;

export const OrderStatus: React.FC<OrderStatusProps> = ({ partyId, order, orderScript, checkScript, shopPhone, timeZone, onUpdate, onDone }) => {
  const { t } = useTranslation('host');
  const [stale, setStale] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const settle = async (action: 'nothing_ordered' | 'receipt_uploaded') => {
    setSettleError(null);
    try {
      onUpdate((await settlePizzaOrder(partyId, order.opopOrderId, action)).order);
    } catch (e) {
      setSettleError(e instanceof Error ? e.message : t('aiOrder.status.couldNotUpdate'));
    }
  };
  const closeConfirm = () => {
    setPending(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  // The webhook updates the server row; this fallback poll keeps the page current. A `calling` order whose call is
  // being checked (pizza-mcp 662d51c `call.checking`) is not final: no webhook announces the check, so keep polling.
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

  const info = statusInfo(order, Date.now(), { timeZone });
  const waiting = !isTerminalStatus(order.status) && !order.restartable;
  const url = order.nextAction?.type === 'open_url' ? order.nextAction.url : null;
  const deferred = order.call?.deferred ?? null;
  const nextTry = formatWhen(deferred?.until, timeZone);
  const finished = order.status === 'confirmed_by_shop' || order.status === 'completed' || !!order.receiptCovered;
  // "another pizzeria" says it is fine to order again: only when pizza-mcp is sure, or a host checked and released it
  const safeToReorder = order.outcome?.nothing_ordered === true || !!order.released;
  const showScript = FALLBACK.includes(order.status) || (order.status === 'canceled' && order.outcome?.nothing_ordered === false);
  const script = safeToReorder ? orderScript : checkScript || orderScript;
  // the backend would refuse another order: no link that leads to that refusal
  const showLeave = (!waiting || order.restartable) && (finished || !order.blocking);
  const callable = !!shopPhone && !!info.callShop && !safeToReorder;
  const deadline = order.status === 'awaiting_price_approval' ? approvalDeadline(order) : null;
  const beforeApproval = order.status === 'awaiting_approval';
  const Icon =
    info.tone === 'success' ? CheckCircle2
      : info.tone === 'warn' || info.tone === 'error' ? AlertTriangle
        : info.tone === 'action' ? BellRing
          : waiting ? Loader2
            : order.status === 'canceled' ? Info : Clock;
  const color =
    info.tone === 'success' ? 'text-[color:var(--ai-success)]'
      : info.tone === 'warn' || info.tone === 'error' ? 'text-[color:var(--ai-warn)]'
        : 'text-theme-text';
  const rowBtn = 'btn-secondary w-full text-sm min-h-[44px] py-2 flex items-center justify-center gap-2';

  return (
    <div className="space-y-3">
      <div className="p-3 bg-theme-surface rounded-xl border border-theme-stroke" role="status" aria-live="polite" aria-atomic="true">
        <div className="flex items-start gap-2">
          <Icon size={18} aria-hidden="true" className={`${color} flex-shrink-0 mt-0.5 ${waiting && info.tone === 'info' ? 'animate-spin' : ''}`} />
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${color}`}>{info.title}</p>
            {info.detail && <p className="text-sm text-theme-text-secondary mt-1">{info.detail}</p>}
          </div>
        </div>
        {info.steps && info.steps.length > 0 && (
          <ol className="mt-2 ml-7 list-decimal list-outside space-y-1 text-sm text-theme-text">
            {info.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
        )}
        {info.caution && <p className="mt-2 ml-7 text-sm font-medium text-theme-text">{info.caution}</p>}
        {deadline && <Countdown deadline={deadline} />}
        {order.ceilingCents != null && order.tier === 'listing' && (
          <p className="text-xs text-theme-text-secondary mt-2">
            {beforeApproval ? t('aiOrder.status.limitBeforeApproval', { amount: formatCents(order.ceilingCents) }) : t('aiOrder.status.limitApproved', { amount: formatCents(order.ceilingCents) })}
          </p>
        )}
        {order.call?.changes && order.call.changes.length > 0 && (
          <ul className="mt-2 list-disc list-inside text-xs text-theme-text-secondary">
            {order.call.changes.map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}
        {nextTry && <p className="mt-2 text-xs text-theme-text-secondary">{t('aiOrder.status.nextTry', { time: nextTry })}</p>}
        {stale && <p className="text-xs text-theme-text-secondary mt-2">{t('aiOrder.status.stale')}</p>}
        {!order.isMine && <p className="text-xs text-theme-text-secondary mt-2">{t('aiOrder.status.otherHost')}</p>}
      </div>

      {callable && (
        <a href={`tel:${shopPhone}`} className={`${url ? 'btn-secondary' : 'btn-primary'} w-full text-sm min-h-[44px] py-2 flex items-center justify-center gap-2`}>
          <Phone size={14} aria-hidden="true" />
          {t('aiOrder.status.callShop', { shop: order.shopName, phone: formatPhone(shopPhone) })}
        </a>
      )}

      {url && order.isMine && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="btn-primary w-full text-sm min-h-[44px] py-2 flex items-center justify-center gap-2">
          <ExternalLink size={14} aria-hidden="true" />
          {order.status === 'awaiting_price_approval' ? t('aiOrder.status.reviewPrice') : order.status === 'held' ? t('aiOrder.status.payNow') : t('aiOrder.status.openApproval')}
        </a>
      )}

      {order.isMine && order.cancelable && (!order.call?.checking || !!order.call?.deferred) && (
        <div>
          {pending === 'cancel' ? (
            <InlineConfirm
              message={
                order.outcome?.nothing_ordered === false || !!order.call?.checking
                  ? t('aiOrder.status.confirmStopCallback', { shop: order.shopName })
                  : t('aiOrder.status.confirmCancel', { shop: order.shopName })
              }
              confirmLabel={t('aiOrder.status.confirmCancelYes')}
              cancelLabel={t('aiOrder.status.keepOrder')}
              busy={canceling}
              onCancel={closeConfirm}
              onConfirm={async () => {
                setCanceling(true);
                setCancelError(null);
                try {
                  onUpdate((await cancelPizzaOrder(partyId, order.opopOrderId)).order);
                  setPending(null);
                } catch (e) {
                  setCancelError(e instanceof Error ? e.message : t('aiOrder.status.couldNotCancel'));
                } finally {
                  setCanceling(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className={rowBtn}
              disabled={canceling}
              onClick={(e) => {
                triggerRef.current = e.currentTarget;
                setPending('cancel');
              }}
            >
              {canceling ? t('aiOrder.status.canceling') : t('aiOrder.status.cancelOrder')}
            </button>
          )}
          {cancelError && <p role="alert" className="text-sm text-[color:var(--ai-error)] mt-1">{cancelError}</p>}
        </div>
      )}

      {order.releasable && (pending === 'release' ? (
        <InlineConfirm
          message={t('aiOrder.status.confirmRelease', { shop: order.shopName })}
          confirmLabel={t('aiOrder.status.confirmReleaseYes')}
          cancelLabel={t('aiOrder.status.notYet')}
          onCancel={closeConfirm}
          onConfirm={() => {
            setPending(null);
            settle('nothing_ordered');
          }}
        />
      ) : (
        <button
          type="button"
          className={rowBtn}
          onClick={(e) => {
            triggerRef.current = e.currentTarget;
            setPending('release');
          }}
        >
          {t('aiOrder.status.release')}
        </button>
      ))}
      {(order.status === 'confirmed_by_shop' || order.releasable) && !order.receiptCovered && (
        <button type="button" className={rowBtn} onClick={() => settle('receipt_uploaded')}>
          {order.status === 'confirmed_by_shop' ? t('aiOrder.status.receiptUploaded') : t('aiOrder.status.pickedUpReceiptUploaded')}
        </button>
      )}
      {settleError && <p role="alert" className="text-sm text-[color:var(--ai-error)]">{settleError}</p>}

      {showScript && script && (
        <div className="p-3 bg-theme-surface rounded-xl border border-theme-stroke space-y-2">
          <p className="text-sm font-medium text-theme-text">{safeToReorder ? t('aiOrder.status.scriptReorder') : t('aiOrder.status.scriptCheck')}</p>
          <pre className="text-sm text-theme-text whitespace-pre-wrap font-sans">{script}</pre>
          <button
            type="button"
            className="btn-secondary text-sm min-h-[44px] py-2 px-4"
            onClick={() => navigator.clipboard?.writeText(script).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => undefined)}
          >
            {copied ? t('aiOrder.status.copied') : t('aiOrder.status.copy')}
          </button>
        </div>
      )}

      {showLeave && (
        <button type="button" onClick={onDone} className={rowBtn}>
          {finished ? t('aiOrder.status.done') : order.restartable ? t('aiOrder.status.startOver') : safeToReorder ? t('aiOrder.status.orderElsewhere') : t('aiOrder.status.backToShops')}
        </button>
      )}
    </div>
  );
};
