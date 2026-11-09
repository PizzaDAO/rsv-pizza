import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ClipboardCopy, ExternalLink, Link2, Loader2, Phone, Store, Trash2 } from 'lucide-react';
import { Checkbox } from './Checkbox';
import { IconInput } from './IconInput';
import { InlineConfirm } from './InlineConfirm';
import {
  addShopOrderingLink, deleteShopOrderingLink, markPizzaHandoff, recordPizzaHandoff, orderingLinks, orderName, safeHref,
  formatCents, formatPhone, Checklist, HandoffProvider, OrderingLink, PizzaHandoffView, PizzaShop,
} from '../lib/pizzaOrder';

type ApiError = Error & { code?: string };

interface HandoffPanelProps {
  partyId: string;
  shop: Pick<PizzaShop, 'id' | 'name' | 'phone' | 'ordering_links'>;
  /** The checklist cart (built by the host); null before a cart exists. */
  cartId: string | null;
  /** pizza-mcp's server checklist (quote's, else the cart's). */
  checklist: Checklist | null;
  hostName: string;
  /** The current row for this shop + cart (a click or a mark), if any. */
  handoff: PizzaHandoffView | null;
  onHandoff: (h: PizzaHandoffView) => void;
  /** Status only: a resumed mark (no checklist, no links). */
  statusOnly?: boolean;
  onDone?: () => void;
}

/**
 * basil-14648 P2: "Order online" handoff. The host orders on the shop's own site (Toast, Square Online, ...) or
 * by phone, with pizza-mcp's checklist. We never automate the shop's checkout. Copy rule: a click is never
 * "ordered"; only the host's own mark says "You said you ordered...".
 */
export const HandoffPanel: React.FC<HandoffPanelProps> = ({ partyId, shop, cartId, checklist, hostName, handoff, onHandoff, statusOnly, onDone }) => {
  const { t } = useTranslation('host');
  const uid = useId();
  const [links, setLinks] = useState<OrderingLink[]>(() => orderingLinks(shop));
  const [placed, setPlaced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [confirmSecond, setConfirmSecond] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const checklistRef = useRef<HTMLPreElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const wasMarked = useRef(handoff?.marked ?? false);

  useEffect(() => setLinks(orderingLinks(shop)), [shop]);
  // after a mark (or its release), move focus to the status card so screen-reader users hear where they are
  useEffect(() => {
    const now = handoff?.marked ?? false;
    if (now && !wasMarked.current) statusRef.current?.focus();
    wasMarked.current = now;
  }, [handoff?.marked]);

  const providerName = (p: HandoffProvider) => t(`aiOrder.handoff.providers.${p}`);
  const name = orderName(hostName);
  const text = checklist ? [name ? t('aiOrder.handoff.nameForOrder', { name }) : null, checklist.text].filter(Boolean).join('\n') : '';

  const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : t('aiOrder.handoff.saveError'));

  /** The click goes first, without blocking the browser's own new-tab navigation (no popup blocker). */
  const onOpen = (link: OrderingLink) => {
    recordPizzaHandoff(partyId, { shopId: shop.id, shopName: shop.name, provider: link.provider, cartId, opened: true })
      .then((r) => onHandoff(r.handoff))
      .catch(() => undefined);
  };

  const onCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      // fallback: select the checklist so the host can copy it by hand
      const el = checklistRef.current;
      const sel = window.getSelection?.();
      if (el && sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setCopyState('failed');
    }
  };

  const doMark = async (allowAnother = false) => {
    setBusy(true);
    setError(null);
    setConfirmSecond(false);
    try {
      // a host who called the shop (or never opened a link) has no row yet: create one without a click
      let row = handoff;
      if (!row || row.releasedAt) {
        const provider: HandoffProvider = handoff?.provider ?? links[0]?.provider ?? 'phone';
        row = (await recordPizzaHandoff(partyId, { shopId: shop.id, shopName: shop.name, provider, cartId, opened: false })).handoff;
      }
      const r = await markPizzaHandoff(partyId, row.id, 'ordered', allowAnother);
      onHandoff(r.handoff);
      setPlaced(false);
      setLive(t('aiOrder.handoff.liveMarked', { shop: shop.name }));
    } catch (e) {
      if ((e as ApiError).code === 'ORDER_IN_PROGRESS') setConfirmSecond(true);
      else setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const settle = async (action: 'unmark' | 'receipt_uploaded') => {
    if (!handoff) return;
    setBusy(true);
    setError(null);
    try {
      const r = await markPizzaHandoff(partyId, handoff.id, action);
      onHandoff(r.handoff);
      setConfirmRelease(false);
      setLive(action === 'unmark' ? t('aiOrder.handoff.liveReleased', { shop: shop.name }) : t('aiOrder.handoff.liveReceipt'));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const addLink = async () => {
    const url = linkUrl.trim();
    if (!url) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      const { link } = await addShopOrderingLink(partyId, shop.id, url);
      if (safeHref(link.url)) setLinks((prev) => [link, ...prev.filter((l) => l.url !== link.url)]);
      setLinkUrl('');
      setLive(t('aiOrder.handoff.linkAdded'));
    } catch (e) {
      setLinkError(errText(e));
    } finally {
      setLinkBusy(false);
    }
  };

  const removeLink = async (link: OrderingLink) => {
    if (!link.id) return;
    setLinkError(null);
    try {
      await deleteShopOrderingLink(partyId, shop.id, link.id);
      setLinks((prev) => prev.filter((l) => l.id !== link.id));
      setLive(t('aiOrder.handoff.linkRemoved'));
    } catch (e) {
      setLinkError(errText(e));
    }
  };

  const marked = !!handoff?.marked;
  const liveRegion = <p role="status" aria-live="polite" className="sr-only">{live}</p>;
  const errorLine = error && <p role="alert" className="text-sm text-[color:var(--ai-error)]">{error}</p>;

  // ---- the host said they ordered: what is held and what to do next ----
  if (marked && handoff) {
    const online = handoff.provider !== 'phone' && handoff.provider !== 'website';
    return (
      <div className="space-y-3">
        {liveRegion}
        <div ref={statusRef} tabIndex={-1} className="p-3 rounded-xl border border-theme-stroke border-l-4 border-l-[color:var(--ai-success)] bg-theme-surface space-y-2 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ai-accent)]">
          <p className="text-sm font-semibold text-theme-text flex items-center gap-2">
            <Check size={16} aria-hidden="true" className="text-[color:var(--ai-success)] flex-shrink-0" />
            {online ? t('aiOrder.handoff.markedOnline', { provider: providerName(handoff.provider) }) : t('aiOrder.handoff.markedPhone', { shop: handoff.shopName })}
          </p>
          <p className="text-sm text-theme-text">
            {handoff.receiptCovered
              ? t('aiOrder.handoff.receiptCovered')
              : handoff.holdCents > 0
                ? t('aiOrder.handoff.markedHold', { shop: handoff.shopName, amount: formatCents(handoff.holdCents) })
                : t('aiOrder.handoff.markedNoHold', { shop: handoff.shopName })}
          </p>
          {!handoff.isMine && <p className="text-sm text-theme-text-secondary">{t('aiOrder.handoff.otherHost')}</p>}
        </div>
        {errorLine}
        {!handoff.receiptCovered && (
          <button type="button" className="btn-primary w-full text-sm min-h-[44px] py-2 flex items-center justify-center gap-2" disabled={busy} onClick={() => settle('receipt_uploaded')}>
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {t('aiOrder.handoff.receiptUploaded')}
          </button>
        )}
        {confirmRelease ? (
          <InlineConfirm
            message={t('aiOrder.handoff.confirmNotOrdered', { shop: handoff.shopName })}
            confirmLabel={t('aiOrder.handoff.confirmNotOrderedYes')}
            cancelLabel={t('aiOrder.handoff.keep')}
            busy={busy}
            onConfirm={() => settle('unmark')}
            onCancel={() => setConfirmRelease(false)}
          />
        ) : (
          <button type="button" className="btn-secondary w-full text-sm min-h-[44px] py-2" disabled={busy} onClick={() => setConfirmRelease(true)}>
            {t('aiOrder.handoff.notOrdered')}
          </button>
        )}
        {onDone && (
          <button type="button" className="btn-secondary w-full text-sm min-h-[44px] py-2" onClick={onDone}>
            {t('aiOrder.handoff.backToShops')}
          </button>
        )}
      </div>
    );
  }

  if (statusOnly) {
    return (
      <div className="space-y-3">
        {liveRegion}
        {errorLine}
        {onDone && (
          <button type="button" className="btn-secondary w-full text-sm min-h-[44px] py-2" onClick={onDone}>
            {t('aiOrder.handoff.backToShops')}
          </button>
        )}
      </div>
    );
  }

  // ---- the checklist, the shop's pages, and the host's own mark ----
  return (
    <section className="space-y-3" aria-labelledby={`${uid}-title`}>
      {liveRegion}
      <h5 id={`${uid}-title`} className="text-sm font-semibold text-theme-text">{t('aiOrder.handoff.title')}</h5>
      <p className="text-sm text-theme-text-secondary">{t('aiOrder.handoff.intro', { shop: shop.name })}</p>

      {(links.length > 0 || shop.phone) && (
        <ul className="flex flex-col gap-2" role="list">
          {links.map((l) => {
            const href = safeHref(l.url);
            if (!href) return null;
            const label = l.provider === 'website' ? t('aiOrder.handoff.website') : t('aiOrder.handoff.orderAt', { provider: providerName(l.provider) });
            return (
              <li key={`${l.provider}:${l.url}`} className="flex gap-2">
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onOpen(l)}
                  className={`${l.provider === 'website' ? 'btn-secondary' : 'btn-primary'} flex-1 text-sm min-h-[44px] py-2 px-3 inline-flex items-center justify-center gap-2 text-center`}
                >
                  <ExternalLink size={14} aria-hidden="true" className="flex-shrink-0" />
                  <span>{label}</span>
                  <span className="sr-only">{t('aiOrder.handoff.newTab')}</span>
                </a>
                {l.source === 'host' && l.id && (
                  <button
                    type="button"
                    className="btn-secondary min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
                    aria-label={t('aiOrder.handoff.removeLink', { provider: providerName(l.provider) })}
                    onClick={() => removeLink(l)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
          {shop.phone && (
            <li>
              <a href={`tel:${shop.phone}`} className="btn-secondary w-full text-sm min-h-[44px] py-2 px-3 inline-flex items-center justify-center gap-2">
                <Phone size={14} aria-hidden="true" /> {t('aiOrder.cart.callShop', { shop: shop.name, phone: formatPhone(shop.phone) })}
              </a>
            </li>
          )}
        </ul>
      )}

      <div className="p-3 bg-theme-surface rounded-xl border border-theme-stroke space-y-2">
        <p className="text-sm font-semibold text-theme-text">{t('aiOrder.handoff.checklistTitle')}</p>
        {checklist ? (
          <>
            <p className="text-xs text-theme-text-secondary">{t('aiOrder.handoff.checklistHelp')}</p>
            <pre ref={checklistRef} className="text-sm text-theme-text whitespace-pre-wrap break-words font-sans bg-theme-surface-hover rounded-lg p-3">{text}</pre>
            <button type="button" className="btn-secondary w-full text-sm min-h-[44px] py-2 inline-flex items-center justify-center gap-2" onClick={onCopy}>
              {copyState === 'copied' ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}
              {copyState === 'copied' ? t('aiOrder.handoff.copied') : t('aiOrder.handoff.copy')}
            </button>
            <p role="status" aria-live="polite" className={copyState === 'failed' ? 'text-sm text-theme-text' : 'sr-only'}>
              {copyState === 'copied' ? t('aiOrder.handoff.copied') : copyState === 'failed' ? t('aiOrder.handoff.copyFailed') : ''}
            </p>
          </>
        ) : (
          <p className="text-sm text-theme-text-secondary">{t('aiOrder.handoff.noChecklist')}</p>
        )}
      </div>

      <div className="space-y-2">
        <Checkbox
          checked={placed}
          onChange={() => setPlaced((v) => !v)}
          label={t('aiOrder.handoff.placedCheckbox', { shop: shop.name })}
          disabled={busy}
          checkboxRole
          className="min-h-[44px] w-full text-left"
        />
        <p className="text-xs text-theme-text-secondary">{t('aiOrder.handoff.markHelp')}</p>
        {placed && !confirmSecond && (
          <button type="button" className="btn-primary w-full text-sm min-h-[44px] py-2 flex items-center justify-center gap-2" disabled={busy} onClick={() => doMark(false)}>
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {busy ? t('aiOrder.handoff.saving') : t('aiOrder.handoff.markOrdered')}
          </button>
        )}
        {confirmSecond && (
          <InlineConfirm
            message={t('aiOrder.handoff.confirmSecond', { shop: shop.name })}
            confirmLabel={t('aiOrder.handoff.confirmSecondYes')}
            cancelLabel={t('aiOrder.handoff.confirmSecondNo')}
            busy={busy}
            onConfirm={() => doMark(true)}
            onCancel={() => setConfirmSecond(false)}
          />
        )}
        {errorLine}
      </div>

      <div className="space-y-2 pt-1">
        <p className="text-sm font-medium text-theme-text flex items-center gap-2"><Store size={14} aria-hidden="true" /> {t('aiOrder.handoff.addLinkTitle')}</p>
        <IconInput
          icon={Link2}
          type="url"
          inputMode="url"
          autoComplete="off"
          value={linkUrl}
          aria-label={t('aiOrder.handoff.addLinkPlaceholder')}
          aria-describedby={`${uid}-linkhelp`}
          placeholder={t('aiOrder.handoff.addLinkPlaceholder')}
          onChange={(e) => setLinkUrl((e as React.ChangeEvent<HTMLInputElement>).target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addLink();
            }
          }}
        />
        <p id={`${uid}-linkhelp`} className="text-xs text-theme-text-secondary">{t('aiOrder.handoff.addLinkHelp')}</p>
        <button type="button" className="btn-secondary w-full sm:w-auto text-sm min-h-[44px] py-2 px-4 inline-flex items-center justify-center gap-2" disabled={linkBusy || !linkUrl.trim()} onClick={addLink}>
          {linkBusy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {t('aiOrder.handoff.addLink')}
        </button>
        {linkError && <p role="alert" className="text-sm text-[color:var(--ai-error)]">{linkError}</p>}
      </div>
    </section>
  );
};
