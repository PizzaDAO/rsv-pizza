import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ClipboardCopy, ExternalLink, Link2, Loader2, Phone, Store, Trash2 } from 'lucide-react';
import { Checkbox } from './Checkbox';
import { IconInput } from './IconInput';
import { InlineConfirm } from './InlineConfirm';
import {
  addShopOrderingLink, deleteShopOrderingLink, markPizzaHandoff, recordPizzaHandoff, orderingLinks, orderName, safeHref,
  formatCents, formatPhone, releasedByOtherHost, Checklist, HandoffBudget, HandoffProvider, OrderingLink, PizzaHandoffView, PizzaShop,
} from '../lib/pizzaOrder';

type ApiError = Error & { code?: string; data?: { existingShopName?: string } };

interface HandoffPanelProps {
  partyId: string;
  shop: Pick<PizzaShop, 'id' | 'name' | 'phone' | 'ordering_links'>;
  /** The checklist cart (built by the host); null before a cart exists. */
  cartId: string | null;
  /** pizza-mcp's server checklist (quote's, else the cart's). */
  checklist: Checklist | null;
  /** The cart's own line summaries: a plain checklist when pizza-mcp sends none (e.g. a native shop). */
  fallbackLines?: string[];
  hostName: string;
  /** The current row for this shop + cart (a click or a mark), if any. */
  handoff: PizzaHandoffView | null;
  onHandoff: (h: PizzaHandoffView) => void;
  /** Status only: a resumed mark (no checklist, no links). */
  statusOnly?: boolean;
  /** The party budget from GET /handoffs, so the copy after a reload matches the copy at mark time. */
  budget?: HandoffBudget | null;
  onDone?: () => void;
}

const isOnline = (p: HandoffProvider) => p !== 'phone' && p !== 'in_person';

/** A USD budget amount ("$210.00 USD"): reimbursement caps are in USD whatever the shop's currency. */
const usd = (c: number) => `${formatCents(c)} USD`;

/**
 * basil-14648 P2: "Order online" handoff. The host orders on the shop's own site (Toast, Square Online, ...), by
 * phone or in person, with pizza-mcp's checklist. We never automate the shop's checkout. Copy rule: a click is never
 * "ordered"; only the host's own mark says "You said you ordered...". The provider is the page the host really
 * clicked; with no click, the host says how they ordered (by phone unless they choose otherwise).
 */
export const HandoffPanel: React.FC<HandoffPanelProps> = ({
  partyId, shop, cartId, checklist, fallbackLines, hostName, handoff, onHandoff, statusOnly, onDone, budget,
}) => {
  const { t } = useTranslation('host');
  const uid = useId();
  const [links, setLinks] = useState<OrderingLink[]>(() => orderingLinks(shop));
  const [placed, setPlaced] = useState(false);
  const [how, setHow] = useState<HandoffProvider>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [confirmSecond, setConfirmSecond] = useState<{ existing: string | null } | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [budgetNote, setBudgetNote] = useState<'noCap' | null>(null);
  const [releasedNote, setReleasedNote] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const checklistRef = useRef<HTMLPreElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const releasedRef = useRef<HTMLParagraphElement>(null);
  const prevMarked = useRef(handoff?.marked ?? false);

  useEffect(() => setLinks(orderingLinks(shop)), [shop]);

  // Focus follows the state change, so screen-reader users hear where they are: the status card after a mark; after
  // a take-back, the visible confirmation (status only) or the panel's title (the checklist view comes back).
  const marked = !!handoff?.marked;
  useEffect(() => {
    if (marked && !prevMarked.current) statusRef.current?.focus();
    if (!marked && prevMarked.current) (statusOnly ? releasedRef.current : titleRef.current)?.focus();
    prevMarked.current = marked;
  }, [marked, statusOnly]);

  const providerName = (p: HandoffProvider) => t(`aiOrder.handoff.providers.${p}`);
  const name = orderName(hostName);
  const listText = checklist?.text ?? (fallbackLines?.length ? fallbackLines.map((l) => `[ ] ${l}`).join('\n') : '');
  const text = listText ? [name ? t('aiOrder.handoff.nameForOrder', { name }) : null, listText].filter(Boolean).join('\n') : '';
  const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : t('aiOrder.handoff.saveError'));

  // the page the host really opened (this cart's row); with none, the host says how they ordered
  const clicked = handoff && !handoff.releasedAt && handoff.clickedAt && isOnline(handoff.provider) ? handoff.provider : null;
  const choices: HandoffProvider[] = [...new Set<HandoffProvider>([...links.map((l) => l.provider), 'phone', 'in_person'])];

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
      setLive(t('aiOrder.handoff.copied'));
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
      setLive(t('aiOrder.handoff.copyFailed'));
    }
  };

  const doMark = async (allowAnother = false) => {
    setBusy(true);
    setError(null);
    setConfirmSecond(null);
    setReleasedNote(null);
    try {
      let row = handoff && !handoff.releasedAt ? handoff : null;
      const provider: HandoffProvider = clicked ?? how;
      // no click on this cart: a row that records how the host says they ordered
      if (!row || !clicked) {
        row = (await recordPizzaHandoff(partyId, { shopId: shop.id, shopName: shop.name, provider, cartId, opened: false })).handoff;
      }
      const r = await markPizzaHandoff(partyId, row.id, 'ordered', allowAnother);
      setBudgetNote(r.budget?.noCap ? 'noCap' : null);
      onHandoff(r.handoff);
      setPlaced(false);
      setLive(t('aiOrder.handoff.liveMarked', { shop: shop.name }));
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'ORDER_IN_PROGRESS') setConfirmSecond({ existing: err.data?.existingShopName ?? null });
      else setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const settle = async (action: 'unmark' | 'release' | 'receipt_uploaded') => {
    if (!handoff) return;
    setBusy(true);
    setError(null);
    try {
      const r = await markPizzaHandoff(partyId, handoff.id, action);
      setConfirmRelease(false);
      if (action === 'receipt_uploaded') {
        setLive(t('aiOrder.handoff.liveReceipt'));
      } else {
        const note = action === 'unmark'
          ? t('aiOrder.handoff.liveReleased', { shop: handoff.shopName })
          : t('aiOrder.handoff.liveReleasedOther', { shop: handoff.shopName });
        setReleasedNote(note);
        setLive(note);
      }
      onHandoff(r.handoff);
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

  const errorLine = error && <p role="alert" className="text-sm text-[color:var(--ai-error)]">{error}</p>;
  const backButton = onDone && (
    <button type="button" className="btn-secondary w-full text-sm min-h-[44px] py-2" onClick={onDone}>
      {t('aiOrder.handoff.backToShops')}
    </button>
  );

  // the host's own mark, released by a co-host who checked: say so (they may have ordered after all)
  const releasedByOther = handoff && releasedByOtherHost(handoff) && !releasedNote && (
    <p className="p-3 rounded-xl border border-theme-stroke border-l-4 border-l-[color:var(--ai-warn)] bg-theme-surface text-sm text-theme-text">
      {t('aiOrder.handoff.releasedByOther', { shop: handoff.shopName })}
    </p>
  );

  let body: React.ReactNode;
  if (marked && handoff) {
    // ---- the host said they ordered: what is held and what to do next ----
    const title =
      handoff.provider === 'website'
        ? t('aiOrder.handoff.markedWebsite', { shop: handoff.shopName })
        : handoff.provider === 'phone'
          ? t('aiOrder.handoff.markedPhone', { shop: handoff.shopName })
          : handoff.provider === 'in_person'
            ? t('aiOrder.handoff.markedInPerson', { shop: handoff.shopName })
            : t('aiOrder.handoff.markedOnline', { provider: providerName(handoff.provider) });
    const noCap = budgetNote === 'noCap' || budget?.noCap === true;
    const holdLine = handoff.receiptCovered
      ? t('aiOrder.handoff.receiptCovered')
      : noCap
        ? t('aiOrder.handoff.markedNoCap', { shop: handoff.shopName })
        : handoff.holdsRest
          ? handoff.holdCents > 0
            ? t('aiOrder.handoff.markedHoldRest', { shop: handoff.shopName, amount: usd(handoff.holdCents) })
            : t('aiOrder.handoff.markedNoBudget', { shop: handoff.shopName })
        : handoff.overBudget
          ? handoff.holdCents > 0
            ? t('aiOrder.handoff.markedOverBudget', { shop: handoff.shopName, amount: usd(handoff.holdCents) })
            : t('aiOrder.handoff.markedNoBudget', { shop: handoff.shopName })
          : handoff.holdCents > 0
            ? t('aiOrder.handoff.markedHold', { shop: handoff.shopName, amount: usd(handoff.holdCents) })
            : t('aiOrder.handoff.markedNoHold', { shop: handoff.shopName });
    body = (
      <>
        <div ref={statusRef} tabIndex={-1} className="p-3 rounded-xl border border-theme-stroke border-l-4 border-l-[color:var(--ai-success)] bg-theme-surface space-y-2 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ai-accent)]">
          <p className="text-sm font-semibold text-theme-text flex items-center gap-2">
            <Check size={16} aria-hidden="true" className="text-[color:var(--ai-success)] flex-shrink-0" />
            {handoff.isMine ? title : t('aiOrder.handoff.markedByOther', { shop: handoff.shopName })}
          </p>
          <p className="text-sm text-theme-text">{holdLine}</p>
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
            message={handoff.isMine ? t('aiOrder.handoff.confirmNotOrdered', { shop: handoff.shopName }) : t('aiOrder.handoff.confirmReleaseOther', { shop: handoff.shopName })}
            confirmLabel={handoff.isMine ? t('aiOrder.handoff.confirmNotOrderedYes') : t('aiOrder.handoff.confirmReleaseOtherYes')}
            cancelLabel={t('aiOrder.handoff.keep')}
            busy={busy}
            onConfirm={() => settle(handoff.isMine ? 'unmark' : 'release')}
            onCancel={() => setConfirmRelease(false)}
          />
        ) : (
          <button type="button" className="btn-secondary w-full text-sm min-h-[44px] py-2" disabled={busy} onClick={() => setConfirmRelease(true)}>
            {handoff.isMine ? t('aiOrder.handoff.notOrdered') : t('aiOrder.handoff.releaseOther')}
          </button>
        )}
        {backButton}
      </>
    );
  } else if (statusOnly) {
    // ---- a resumed mark that was just taken back: say so, visibly ----
    body = (
      <>
        {releasedByOther}
        {releasedNote && (
          <p ref={releasedRef} tabIndex={-1} className="p-3 rounded-xl border border-theme-stroke bg-theme-surface text-sm text-theme-text outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ai-accent)]">
            {releasedNote}
          </p>
        )}
        {errorLine}
        {backButton}
      </>
    );
  } else {
    // ---- the checklist, the shop's pages, and the host's own mark ----
    body = (
      <>
        <h5 id={`${uid}-title`} ref={titleRef} tabIndex={-1} className="text-sm font-semibold text-theme-text outline-none">{t('aiOrder.handoff.title')}</h5>
        {releasedNote && <p className="text-sm text-theme-text">{releasedNote}</p>}
        {releasedByOther}
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
          {text ? (
            <>
              <p className="text-xs text-theme-text-secondary">{t('aiOrder.handoff.checklistHelp')}</p>
              <pre ref={checklistRef} className="text-sm text-theme-text whitespace-pre-wrap break-words font-sans bg-theme-surface-hover rounded-lg p-3">{text}</pre>
              <button type="button" className="btn-secondary w-full text-sm min-h-[44px] py-2 inline-flex items-center justify-center gap-2" onClick={onCopy}>
                {copyState === 'copied' ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}
                {copyState === 'copied' ? t('aiOrder.handoff.copied') : t('aiOrder.handoff.copy')}
              </button>
              {copyState === 'failed' && <p className="text-sm text-theme-text">{t('aiOrder.handoff.copyFailed')}</p>}
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
          {placed && !clicked && (
            <div role="radiogroup" aria-labelledby={`${uid}-how`} className="space-y-1.5">
              <p id={`${uid}-how`} className="text-sm font-medium text-theme-text">{t('aiOrder.handoff.howTitle')}</p>
              <div className="flex flex-col gap-2">
                {choices.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={how === p}
                    onClick={() => setHow(p)}
                    className={`${how === p ? 'btn-primary' : 'btn-secondary'} w-full text-sm min-h-[44px] py-2 px-3 text-left`}
                  >
                    {p === 'phone'
                      ? t('aiOrder.handoff.howPhone')
                      : p === 'in_person'
                        ? t('aiOrder.handoff.howInPerson')
                        : p === 'website'
                          ? t('aiOrder.handoff.howWebsite')
                          : t('aiOrder.handoff.howOnline', { provider: providerName(p) })}
                  </button>
                ))}
              </div>
            </div>
          )}
          {placed && !confirmSecond && (
            <button type="button" className="btn-primary w-full text-sm min-h-[44px] py-2 flex items-center justify-center gap-2" disabled={busy} onClick={() => doMark(false)}>
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {busy ? t('aiOrder.handoff.saving') : t('aiOrder.handoff.markOrdered')}
            </button>
          )}
          {confirmSecond && (
            <InlineConfirm
              message={
                confirmSecond.existing
                  ? t('aiOrder.handoff.confirmSecondAt', { shop: shop.name, existing: confirmSecond.existing })
                  : t('aiOrder.handoff.confirmSecond', { shop: shop.name })
              }
              confirmLabel={t('aiOrder.handoff.confirmSecondYes')}
              cancelLabel={t('aiOrder.handoff.confirmSecondNo')}
              busy={busy}
              onConfirm={() => doMark(true)}
              onCancel={() => setConfirmSecond(null)}
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
      </>
    );
  }

  // ONE live region for every state: it stays mounted, so an announcement survives the view switching under it
  return (
    <section className="space-y-3" aria-labelledby={marked || statusOnly ? undefined : `${uid}-title`}>
      <p role="status" aria-live="polite" className="sr-only">{live}</p>
      {body}
    </section>
  );
};
