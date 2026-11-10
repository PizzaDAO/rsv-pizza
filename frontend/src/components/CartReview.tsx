import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Clock, DollarSign, User, Phone, ArrowLeft } from 'lucide-react';
import { IconInput } from './IconInput';
import {
  CartResponse, CartDecision, PizzaShop, formatCents, toE164, defaultPickupLocal, zonedLocalToIso, safeTimeZone, formatWhen, formatPhone,
} from '../lib/pizzaOrder';

interface CartReviewProps {
  shop: PizzaShop;
  /** Null until the first cart build. */
  cartState: CartResponse | null;
  building: boolean;
  /** A build error (shown under the build button). */
  error: string | null;
  /** An approve/place error: shown next to the Approve button and scrolled into view. */
  approveError?: string | null;
  /** Shown under the Approve button (e.g. "this party already has an order"). */
  approveNotice?: React.ReactNode;
  defaultName: string;
  partyDate: string | null;
  /** The party's IANA time zone: the pickup time is entered and shown on its clock. */
  timeZone?: string | null;
  /** The party's city, for the "{city} time" label. */
  city?: string | null;
  onBuild: (pickupAtIso: string) => void;
  /** The host answered a question about one pizza; rebuild with that decision. */
  onDecide: (pickupAtIso: string, ref: string, choice: CartDecision) => void;
  onApprove: (input: { ceilingCents?: number; substitution: 'exact' | 'deals_ok'; contact: { name: string; phone: string } }) => void;
  placing: boolean;
  onBack: () => void;
}

const Field: React.FC<{ id: string; label: string; help?: React.ReactNode; children: React.ReactNode }> = ({ id, label, help, children }) => (
  <div className="space-y-1">
    <label htmlFor={id} className="block text-sm font-medium text-theme-text">{label}</label>
    {children}
    {help && <p id={`${id}-help`} className="text-xs text-theme-text-secondary">{help}</p>}
  </div>
);

export const CartReview: React.FC<CartReviewProps> = ({
  shop, cartState, building, error, approveError, approveNotice, defaultName, partyDate, timeZone, city, onBuild, onDecide, onApprove, placing, onBack,
}) => {
  const { t } = useTranslation('host');
  const tz = safeTimeZone(timeZone);
  const [pickupLocal, setPickupLocal] = useState(() => defaultPickupLocal(partyDate, new Date(), tz));
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState('');
  const [dealsOk, setDealsOk] = useState(false);
  const [ceilingText, setCeilingText] = useState<string | null>(null);
  const approveErrorRef = useRef<HTMLParagraphElement>(null);
  const uid = useId();
  const ids = { pickup: `${uid}-pickup`, ceiling: `${uid}-ceiling`, name: `${uid}-name`, phone: `${uid}-phone`, deals: `${uid}-deals` };

  useEffect(() => {
    if (approveError) approveErrorRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [approveError]);

  const quote = cartState?.quote ?? null;
  const isPhone = shop.tier !== 'native';
  const maxCeiling = useMemo(() => {
    const caps = [quote?.price_ceiling_cents, cartState?.remainingCapCents].filter((c): c is number => typeof c === 'number');
    return caps.length ? Math.min(...caps) : null;
  }, [quote, cartState]);

  const ceilingCents = ceilingText !== null ? Math.round(Number(ceilingText) * 100) : maxCeiling ?? 0;
  // native orders have no ceiling to choose: the quote is binding
  const ceilingOk = !isPhone || (ceilingCents > 0 && (maxCeiling === null || ceilingCents <= maxCeiling));
  const e164 = toE164(phone);
  const pickupIso = zonedLocalToIso(pickupLocal, tz);
  const ready = !!quote && !cartState?.issues.length && ceilingOk && !!e164 && name.trim().length > 0;
  // say what is missing instead of a silent disabled button
  const missing = !quote
    ? null
    : cartState?.issues.length
      ? t('aiOrder.cart.missingIssues')
      : !ceilingOk
        ? t('aiOrder.cart.missingLimit')
        : !name.trim()
          ? t('aiOrder.cart.missingName')
          : !e164
            ? t('aiOrder.cart.missingPhone')
            : null;
  const zoneLabel = tz
    ? city ? t('aiOrder.cart.pickupZoneCity', { shop: shop.name, city, tz }) : t('aiOrder.cart.pickupZone', { shop: shop.name, tz })
    : t('aiOrder.cart.pickupZoneLocal', { shop: shop.name });
  const lines = cartState?.cart?.lines ?? [];
  const callShop = shop.phone ? (
    <a href={`tel:${shop.phone}`} className="btn-secondary text-sm min-h-[44px] py-2 px-4 inline-flex items-center gap-2">
      <Phone size={14} aria-hidden="true" /> {t('aiOrder.cart.callShop', { shop: shop.name, phone: formatPhone(shop.phone) })}
    </a>
  ) : null;

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="min-h-[44px] -ml-1 px-1 inline-flex items-center gap-1 text-sm text-theme-text-secondary hover:text-theme-text">
        <ArrowLeft size={16} aria-hidden="true" /> {t('aiOrder.cart.back')}
      </button>
      <h4 className="font-semibold text-theme-text text-base break-words">{shop.name}</h4>

      <div className="space-y-2">
        <Field id={ids.pickup} label={t('aiOrder.cart.pickupLabel')} help={<>{zoneLabel}<br />{t('aiOrder.cart.pickupOnly')}</>}>
          <IconInput
            id={ids.pickup}
            icon={Clock}
            type="datetime-local"
            value={pickupLocal}
            aria-describedby={`${ids.pickup}-help`}
            onChange={(e) => setPickupLocal((e as React.ChangeEvent<HTMLInputElement>).target.value)}
          />
        </Field>
        <button
          type="button"
          className={`${cartState ? 'btn-secondary' : 'btn-primary'} w-full sm:w-auto text-sm min-h-[44px] py-2 px-4 flex items-center justify-center gap-2`}
          disabled={building || !pickupIso}
          onClick={() => pickupIso && onBuild(pickupIso)}
        >
          {building && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {cartState ? t('aiOrder.cart.rebuild') : t('aiOrder.cart.build')}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-[color:var(--ai-error)]">{error}</p>}
      <p role="status" className="sr-only">{building ? t('aiOrder.cart.liveBuilding') : quote ? t('aiOrder.cart.liveReady') : ''}</p>

      {cartState?.issues.length ? (
        <div className="p-3 rounded-xl border border-theme-stroke border-l-4 border-l-[color:var(--ai-warn)] bg-theme-surface space-y-3">
          <p className="text-sm font-semibold text-theme-text">{t('aiOrder.cart.issuesTitle')}</p>
          {cartState.issues.map((i) => (
            <div key={i.ref} className="space-y-1.5">
              <p className="text-sm text-theme-text-secondary">
                <span className="font-medium text-theme-text">{i.label}.</span> {i.ask_user}
              </p>
              <div className="flex flex-wrap gap-2">
                {i.choices.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="btn-secondary text-sm min-h-[44px] py-2 px-4"
                    disabled={building || !pickupIso}
                    onClick={() => pickupIso && onDecide(pickupIso, i.ref, c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-sm text-theme-text-secondary">{t('aiOrder.cart.issuesKept')}</p>
          {callShop}
        </div>
      ) : null}

      {cartState && !cartState.cart && cartState.issues.length === 0 && (
        <div className="space-y-2">
          <p className="text-sm text-theme-text">{t('aiOrder.cart.nothingLeft')}</p>
          {callShop}
        </div>
      )}

      {cartState && (cartState.notices.length > 0 || cartState.dropped.length > 0) && (
        <ul className="list-disc list-inside text-sm text-theme-text-secondary space-y-0.5">
          {cartState.notices.map((n) => <li key={n}>{n}</li>)}
          {cartState.dropped.map((d) => <li key={d.ref}>{t('aiOrder.cart.skipping', { label: d.label })}</li>)}
        </ul>
      )}

      {quote && (
        <div className="p-3 bg-theme-surface rounded-xl border border-theme-stroke space-y-2">
          <p className="text-sm font-semibold text-theme-text">{t('aiOrder.cart.exactly')}</p>
          {lines.length > 0 ? (
            <ul className="text-sm text-theme-text space-y-1">
              {lines.map((l) => <li key={l.id}>{l.summary || `${l.quantity}x ${[l.size_name, l.item_name].filter(Boolean).join(' ')}`}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-theme-text whitespace-pre-line">{quote.read_back}</p>
          )}
          {pickupIso && <p className="text-sm text-theme-text-secondary">{t('aiOrder.cart.pickupAt', { time: formatWhen(pickupIso, tz) })}</p>}
          {quote.estimate ? (
            <p className="text-sm text-theme-text-secondary">
              {t('aiOrder.cart.estimate', { low: formatCents(quote.estimate.low_cents), high: formatCents(quote.estimate.high_cents), expected: formatCents(quote.estimate.expected_cents) })}
            </p>
          ) : (
            <p className="text-sm text-theme-text-secondary">{t('aiOrder.cart.total', { total: quote.total_display })}</p>
          )}
        </div>
      )}

      {quote && isPhone && (
        <div className="space-y-2">
          <Field
            id={ids.ceiling}
            label={t('aiOrder.cart.limitLabel')}
            help={maxCeiling !== null
              ? cartState?.remainingCapCents != null
                ? t('aiOrder.cart.limitHelpBudget', { max: formatCents(maxCeiling), left: formatCents(cartState.remainingCapCents) })
                : t('aiOrder.cart.limitHelpMax', { max: formatCents(maxCeiling) })
              : t('aiOrder.cart.limitHelp')}
          >
            <IconInput
              id={ids.ceiling}
              icon={DollarSign}
              type="text"
              inputMode="decimal"
              aria-describedby={`${ids.ceiling}-help`}
              aria-invalid={!ceilingOk}
              value={ceilingText ?? (maxCeiling ? (maxCeiling / 100).toFixed(2) : '')}
              onChange={(e) => setCeilingText((e as React.ChangeEvent<HTMLInputElement>).target.value)}
              placeholder={t('aiOrder.cart.limitPlaceholder')}
            />
          </Field>
          {!ceilingOk && <p role="alert" className="text-sm text-[color:var(--ai-error)]">{t('aiOrder.cart.limitTooHigh', { max: formatCents(maxCeiling) })}</p>}
          <label htmlFor={ids.deals} className="flex items-start gap-3 min-h-[44px] py-1 cursor-pointer">
            <input
              id={ids.deals}
              type="checkbox"
              checked={dealsOk}
              onChange={() => setDealsOk((v) => !v)}
              aria-describedby={`${ids.deals}-help`}
              className="mt-0.5 h-6 w-6 flex-shrink-0 accent-[#c8262a] cursor-pointer"
            />
            <span>
              <span className="block text-sm text-theme-text">{t('aiOrder.cart.dealsLabel')}</span>
              <span id={`${ids.deals}-help`} className="block text-xs text-theme-text-secondary">{t('aiOrder.cart.dealsHelp')}</span>
            </span>
          </label>
        </div>
      )}

      {quote && (
        <div className="space-y-3">
          <Field id={ids.name} label={t('aiOrder.cart.nameLabel')} help={t('aiOrder.cart.nameHelp')}>
            <IconInput id={ids.name} icon={User} type="text" autoComplete="name" aria-describedby={`${ids.name}-help`} value={name} onChange={(e) => setName((e as React.ChangeEvent<HTMLInputElement>).target.value)} placeholder={t('aiOrder.cart.namePlaceholder')} />
          </Field>
          <Field id={ids.phone} label={t('aiOrder.cart.phoneLabel')} help={t('aiOrder.cart.phoneHelp')}>
            <IconInput id={ids.phone} icon={Phone} type="tel" autoComplete="tel" aria-describedby={`${ids.phone}-help`} aria-invalid={!!phone && !e164} value={phone} onChange={(e) => setPhone((e as React.ChangeEvent<HTMLInputElement>).target.value)} placeholder={t('aiOrder.cart.phonePlaceholder')} />
          </Field>
          {phone && !e164 && <p role="alert" className="text-sm text-[color:var(--ai-error)]">{t('aiOrder.cart.phoneInvalid')}</p>}
          <button
            type="button"
            className="btn-primary w-full text-sm min-h-[44px] py-2 flex items-center justify-center gap-2"
            disabled={!ready || placing}
            aria-describedby={missing ? `${uid}-missing` : undefined}
            onClick={() => e164 && onApprove({ ...(isPhone ? { ceilingCents } : {}), substitution: dealsOk ? 'deals_ok' : 'exact', contact: { name: name.trim(), phone: e164 } })}
          >
            {placing && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {isPhone ? t('aiOrder.cart.approve') : t('aiOrder.cart.continuePayment')}
          </button>
          {missing && <p id={`${uid}-missing`} className="text-sm text-theme-text">{missing}</p>}
          {approveError && <p ref={approveErrorRef} role="alert" className="text-sm text-[color:var(--ai-error)]">{approveError}</p>}
          {approveNotice}
          <p className="text-sm text-theme-text-secondary">
            {isPhone ? t('aiOrder.cart.nextPhone', { shop: shop.name }) : t('aiOrder.cart.nextNative')}
          </p>
        </div>
      )}
    </div>
  );
};
