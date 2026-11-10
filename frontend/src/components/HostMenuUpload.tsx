import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, FileUp, Link2, Loader2, X } from 'lucide-react';
import { IconInput } from './IconInput';
import { InlineConfirm } from './InlineConfirm';
import {
  CartMenu, HostMenuResult, MenuFileError, MENU_LIMITS, deleteHostMenu, formatCents, hostMenuErrorKey, prepareMenuFiles,
  formatMenuDate, submitHostMenuFiles, submitHostMenuUrl,
} from '../lib/pizzaOrder';

/**
 * basil-14648 P2 (plans/rsv-p2-host-menus.md): "Use this shop's real menu". The host adds a photo (up to 3), a PDF
 * or a link; pizza-mcp reads it (15-40 s) and keeps it PRIVATE to this host, for their new carts only. On success
 * the flow rebuilds the cart (`onChanged`), so the estimate comes from the shop's own prices. Every problem is plain
 * copy with a next step, and the host can remove the menu again.
 *
 * Shown only when rsv's switch is on and pizza-mcp takes host menus (config.hostMenus), for listing shops.
 */
interface HostMenuUploadProps {
  partyId: string;
  shop: { id: string; name: string };
  /** The menu the current cart was built on, if any (a cart keeps it for life). */
  cartMenu?: CartMenu | null;
  /** Open the panel straight away (the host tapped "Use this shop's real menu" on the shop list). */
  defaultOpen?: boolean;
  /** The party's time zone, for the menu's date. */
  timeZone?: string | null;
  /** The menu was added or removed: the flow rebuilds the cart (or returns false when there is no cart yet). */
  onChanged: (change: 'added' | 'removed') => Promise<boolean> | boolean;
  /** The cart is being rebuilt on the new menu. */
  rebuilding?: boolean;
  /** Test seam: the photo downscale. */
  prepare?: (files: File[]) => Promise<Blob[]>;
}

type Phase = 'idle' | 'preparing' | 'reading' | 'removing';

export const HostMenuUpload: React.FC<HostMenuUploadProps> = ({
  partyId, shop, cartMenu, defaultOpen = false, timeZone, onChanged, rebuilding = false, prepare = prepareMenuFiles,
}) => {
  const { t, i18n } = useTranslation('host');
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<'files' | 'link'>('files');
  const [files, setFiles] = useState<File[]>([]);
  const [link, setLink] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HostMenuResult | null>(null);
  const [removed, setRemoved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // the menu was read before any cart existed: the next build uses it
  const [noCartYet, setNoCartYet] = useState(false);
  const uid = useId();
  const ids = { files: `${uid}-files`, link: `${uid}-link`, title: `${uid}-title` };
  const firstControl = useRef<HTMLButtonElement>(null);
  const opened = useRef(defaultOpen);

  // move focus into the panel when the host opens it (not on first render, unless it was asked for)
  useEffect(() => {
    if (open && opened.current) firstControl.current?.focus();
    opened.current = true;
  }, [open]);

  const busy = phase !== 'idle';
  // the menu in use: the one just read, else the cart's own (a menu from an earlier visit)
  const usingMine = !removed && (result != null || cartMenu?.provenance === 'host_provided');
  const asOf = result?.asOf ?? (cartMenu?.provenance === 'host_provided' ? cartMenu.as_of : null);
  const date = formatMenuDate(asOf, i18n.language, timeZone);

  const fail = (code: string | undefined) => setError(t(hostMenuErrorKey(code)));

  async function submit() {
    if (busy) return;
    setError(null);
    setRemoved(false);
    try {
      let r: HostMenuResult;
      if (mode === 'files') {
        if (!files.length) return fail('NO_FILES');
        setPhase('preparing');
        const ready = await prepare(files);
        setPhase('reading');
        r = await submitHostMenuFiles(partyId, shop.id, ready);
      } else {
        const url = link.trim();
        if (!/^https?:\/\//i.test(url) || url.length > MENU_LIMITS.maxUrlChars) {
          setError(t('aiOrder.menu.errors.NO_LINK'));
          return;
        }
        setPhase('reading');
        r = await submitHostMenuUrl(partyId, shop.id, url);
      }
      setResult(r);
      setFiles([]);
      setLink('');
      setOpen(false);
      setPhase('idle');
      // a cart keeps its menu for life: the flow builds a NEW one on this menu
      setNoCartYet((await onChanged('added')) === false);
    } catch (e) {
      setPhase('idle');
      fail(e instanceof MenuFileError ? e.code : (e as { code?: string })?.code);
    }
  }

  async function remove() {
    setConfirmRemove(false);
    setError(null);
    setPhase('removing');
    try {
      await deleteHostMenu(partyId, shop.id);
      setResult(null);
      setRemoved(true);
      setPhase('idle');
      await onChanged('removed');
    } catch {
      setPhase('idle');
      setError(t('aiOrder.menu.removeError'));
    }
  }

  const summary = result
    ? result.summary.priceRangeCents
      ? t('aiOrder.menu.resultRange', {
          pizzas: result.summary.pizzaItems, priced: result.summary.pricedItems,
          low: formatCents(result.summary.priceRangeCents[0]), high: formatCents(result.summary.priceRangeCents[1]),
        })
      : t('aiOrder.menu.result', { pizzas: result.summary.pizzaItems, priced: result.summary.pricedItems })
    : null;

  // one polite live region for progress and results; errors are alerts of their own
  const live =
    phase === 'preparing' ? t('aiOrder.menu.preparing')
      : phase === 'reading' ? t('aiOrder.menu.reading')
        : phase === 'removing' ? t('aiOrder.menu.removing')
          : rebuilding && result ? `${summary} ${t('aiOrder.menu.rebuilding')}`
            : summary ? summary
              : removed ? t('aiOrder.menu.removed') : '';

  const errorBox = error && (
    <p role="alert" className="text-sm text-[color:var(--ai-error)]">{error}</p>
  );

  return (
    <section aria-labelledby={ids.title} className="p-3 rounded-xl border border-theme-stroke bg-theme-surface space-y-2">
      <p role="status" aria-live="polite" className="sr-only">{live}</p>

      {usingMine ? (
        <div className="space-y-2">
          <p id={ids.title} className="text-sm font-semibold text-theme-text flex items-center gap-2">
            <BookOpen size={16} aria-hidden="true" className="flex-shrink-0" /> {t('aiOrder.menu.using', { date })}
          </p>
          {summary && (
            <p className="text-sm text-theme-text">
              {summary} {rebuilding ? t('aiOrder.menu.rebuilding') : noCartYet ? t('aiOrder.menu.readNext') : ''}
            </p>
          )}
          <p className="text-sm text-theme-text-secondary">{t('aiOrder.menu.usingHelp')}</p>
        </div>
      ) : (
        <div className="space-y-1">
          <p id={ids.title} className="text-sm font-semibold text-theme-text flex items-center gap-2">
            <BookOpen size={16} aria-hidden="true" className="flex-shrink-0" />
            {open ? t('aiOrder.menu.panelTitle', { shop: shop.name }) : t('aiOrder.menu.offerTitle')}
          </p>
          {removed && <p className="text-sm text-theme-text">{t('aiOrder.menu.removed')}</p>}
          <p className="text-sm text-theme-text-secondary">{t('aiOrder.menu.offerHelp', { shop: shop.name })}</p>
        </div>
      )}

      {!open && !confirmRemove && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            className="btn-secondary w-full sm:w-auto text-sm min-h-[44px] py-2 px-4 inline-flex items-center justify-center gap-2"
            disabled={busy}
            aria-expanded={false}
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
          >
            <FileUp size={14} aria-hidden="true" /> {usingMine ? t('aiOrder.menu.replace') : t('aiOrder.menu.offer')}
          </button>
          {usingMine && (
            <button
              type="button"
              className="btn-secondary w-full sm:w-auto text-sm min-h-[44px] py-2 px-4 inline-flex items-center justify-center gap-2"
              disabled={busy || rebuilding}
              onClick={() => setConfirmRemove(true)}
            >
              {phase === 'removing' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {t('aiOrder.menu.remove')}
            </button>
          )}
        </div>
      )}

      {confirmRemove && (
        <InlineConfirm
          message={t('aiOrder.menu.removeConfirm', { shop: shop.name })}
          confirmLabel={t('aiOrder.menu.removeYes')}
          cancelLabel={t('aiOrder.menu.removeNo')}
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirmRemove(false)}
        />
      )}

      {open && (
        <div className="space-y-3">
          <div role="group" aria-label={t('aiOrder.menu.modeLabel')} className="grid grid-cols-2 gap-2">
            {(['files', 'link'] as const).map((m, i) => (
              <button
                key={m}
                ref={i === 0 ? firstControl : undefined}
                type="button"
                aria-pressed={mode === m}
                disabled={busy}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`${mode === m ? 'btn-primary' : 'btn-secondary'} text-sm min-h-[44px] py-2 px-3 inline-flex items-center justify-center gap-2`}
              >
                {m === 'files' ? <FileUp size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
                {m === 'files' ? t('aiOrder.menu.modeFiles') : t('aiOrder.menu.modeLink')}
              </button>
            ))}
          </div>

          {mode === 'files' ? (
            <div className="space-y-1">
              <span className="block text-sm font-medium text-theme-text" id={`${ids.files}-label`}>{t('aiOrder.menu.filesLabel')}</span>
              {/* the label is the visible 44px button; the native input stays reachable by keyboard and screen readers */}
              <label
                htmlFor={ids.files}
                className="btn-secondary w-full text-sm min-h-[44px] py-2 px-4 inline-flex items-center justify-center gap-2 cursor-pointer focus-within:ring-2 focus-within:ring-[color:var(--ai-accent)]"
              >
                <FileUp size={14} aria-hidden="true" /> {t('aiOrder.menu.chooseFiles')}
                <input
                  id={ids.files}
                  type="file"
                  // no `capture`: on phones that would force the camera and hide the photo library
                  accept="image/*,application/pdf"
                  multiple
                  disabled={busy}
                  aria-labelledby={`${ids.files}-label`}
                  aria-describedby={`${ids.files}-help`}
                  className="sr-only"
                  onChange={(e) => {
                    setFiles(Array.from(e.target.files ?? []));
                    setError(null);
                  }}
                />
              </label>
              <p id={`${ids.files}-help`} className="text-xs text-theme-text-secondary">{t('aiOrder.menu.filesHelp')}</p>
              {files.length > 0 && (
                <p className="text-sm text-theme-text break-words">
                  {t('aiOrder.menu.chosen', { count: files.length, names: files.map((f) => f.name).join(', ') })}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <label htmlFor={ids.link} className="block text-sm font-medium text-theme-text">{t('aiOrder.menu.linkLabel')}</label>
              <IconInput
                id={ids.link}
                icon={Link2}
                type="url"
                inputMode="url"
                autoComplete="url"
                maxLength={MENU_LIMITS.maxUrlChars}
                aria-describedby={`${ids.link}-help`}
                disabled={busy}
                value={link}
                placeholder={t('aiOrder.menu.linkPlaceholder')}
                onChange={(e) => {
                  setLink((e as React.ChangeEvent<HTMLInputElement>).target.value);
                  setError(null);
                }}
              />
              <p id={`${ids.link}-help`} className="text-xs text-theme-text-secondary">{t('aiOrder.menu.linkHelp')}</p>
            </div>
          )}

          <p className="text-sm text-theme-text-secondary">{t('aiOrder.menu.private')}</p>
          {errorBox}

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              className="btn-primary w-full sm:w-auto text-sm min-h-[44px] py-2 px-4 inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={busy || (mode === 'files' ? files.length === 0 : !link.trim())}
              onClick={submit}
            >
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {t('aiOrder.menu.read')}
            </button>
            <button
              type="button"
              className="btn-secondary w-full sm:w-auto text-sm min-h-[44px] py-2 px-4 inline-flex items-center justify-center gap-2"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              <X size={14} aria-hidden="true" /> {t('aiOrder.menu.close')}
            </button>
          </div>
          {busy && (
            <p className="text-sm text-theme-text flex items-center gap-2" aria-hidden="true">
              <Loader2 size={14} className="animate-spin" />
              {phase === 'preparing' ? t('aiOrder.menu.preparing') : t('aiOrder.menu.reading')}
            </p>
          )}
        </div>
      )}

      {!open && errorBox}
    </section>
  );
};
