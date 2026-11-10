import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Clock, DollarSign, User, Phone, ArrowLeft, ShoppingBag, Mail, Bot } from 'lucide-react';
import { IconInput } from './IconInput';
import {
  CartResponse, CartDecision, PizzaShop, formatCents, toE164, defaultPickupLocal, zonedLocalToIso, safeTimeZone, formatWhen, formatPhone,
  hasProviderLink, formatMenuDate, EmailAlternative, OrderChannel, emailPickupProblem, defaultEmailPickupLocal, pizzaCount,
} from '../lib/pizzaOrder';

/** pizza-mcp's published email rules, when the shop's own numbers are not at hand. */
const EMAIL_RULES: Pick<EmailAlternative, 'min_lead_hours' | 'max_lead_days' | 'min_pizzas' | 'max_pizzas' | 'max_total_cents'> = {
  min_lead_hours: 24, max_lead_days: 21, min_pizzas: 8, max_pizzas: 40, max_total_cents: 80_000,
};

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
  /**
   * basil-14648 P2: 'handoff' = the host orders from the shop themselves (online or by phone) with the checklist:
   * no AI call, so no price limit, contact or Approve. `handoffSlot` (the HandoffPanel) renders in their place.
   */
  mode?: 'ai' | 'handoff';
  handoffSlot?: React.ReactNode;
  /** Offered on a callable listing shop that also takes orders online. */
  onSwitchToHandoff?: () => void;
  /** basil-14648 P2: "Use this shop's real menu" (HostMenuUpload), shown above the estimate when offered. */
  menuSlot?: React.ReactNode;
  /** A menu read is in flight: Back, Build, the pizza questions and Approve wait for it. */
  locked?: boolean;
  /** basil-14648 P2: `email` = we email the shop the order (it confirms by a link) instead of calling. */
  channel?: OrderChannel;
  /** The shop's email alternative when the host may email it now (else null: no "Email the order instead"). */
  emailAlt?: EmailAlternative | null;
  /** Switch between the call and the email (the cart is built again: a quote is bound to its channel). */
  onSwitchChannel?: (c: OrderChannel) => void;
  /** Our AI can phone this shop (for "Have our AI call instead"). */
  callable?: boolean;
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
  mode = 'ai', handoffSlot, onSwitchToHandoff, menuSlot, locked = false, channel = 'ai_phone', emailAlt = null, onSwitchChannel, callable = false,
}) => {
  const handoff = mode === 'handoff';
  const email = channel === 'email' && !handoff;
  const rules = emailAlt ?? EMAIL_RULES;
  const { t, i18n } = useTranslation('host');
  const tz = safeTimeZone(timeZone);
  const [pickupLocal, setPickupLocal] = useState(() =>
    email ? defaultEmailPickupLocal(partyDate, rules, new Date(), tz) : defaultPickupLocal(partyDate, new Date(), tz)
  );
  // switching to an email order moves a too-early pickup to the first time the email rules allow
  useEffect(() => {
    if (!email) return;
    const iso = zonedLocalToIso(pickupLocal, tz);
    if (emailPickupProblem(iso, rules) === 'too_soon') setPickupLocal(defaultEmailPickupLocal(partyDate, rules, new Date(), tz));
    // only when the channel changes: the host's own later edits are checked, never overwritten
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);
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
    // an email order also stops at the email cap (pizza-mcp caps the email quote there too)
    const caps = [quote?.price_ceiling_cents, cartState?.remainingCapCents, email ? rules.max_total_cents : null].filter((c): c is number => typeof c === 'number');
    return caps.length ? Math.min(...caps) : null;
  }, [quote, cartState, email, rules.max_total_cents]);

  const ceilingCents = ceilingText !== null ? Math.round(Number(ceilingText) * 100) : maxCeiling ?? 0;
  // native orders have no ceiling to choose: the quote is binding
  const ceilingOk = !isPhone || (ceilingCents > 0 && (maxCeiling === null || ceilingCents <= maxCeiling));
  const e164 = toE164(phone);
  const pickupIso = zonedLocalToIso(pickupLocal, tz);
  // basil-14648 P2: the email rules the host can see and fix here: the lead time, and the size of what is left
  const leadProblem = email ? emailPickupProblem(pickupIso, rules) : null;
  const leadText = leadProblem === 'too_soon'
    ? t('aiOrder.email.pickupTooSoon', { minHours: rules.min_lead_hours })
    : leadProblem === 'too_late' ? t('aiOrder.email.pickupTooLate', { maxDays: rules.max_lead_days }) : null;
  const lineCount = pizzaCount(cartState?.cart?.lines ?? []);
  const sizeText = email && cartState?.cart && lineCount > 0
    ? lineCount < rules.min_pizzas
      ? t('aiOrder.email.tooFew', { minPizzas: rules.min_pizzas, count: lineCount })
      : lineCount > rules.max_pizzas ? t('aiOrder.email.tooMany', { maxPizzas: rules.max_pizzas, count: lineCount }) : null
    : null;
  const ready = !!quote && !cartState?.issues.length && ceilingOk && !!e164 && name.trim().length > 0 && !leadProblem && !sizeText;
  // say what is missing instead of a silent disabled button
  const missing = !quote
    ? null
    : leadText ?? sizeText ?? (cartState?.issues.length
      ? t('aiOrder.cart.missingIssues')
      : !ceilingOk
        ? t('aiOrder.cart.missingLimit')
        : !name.trim()
          ? t('aiOrder.cart.missingName')
          : !e164
            ? t('aiOrder.cart.missingPhone')
            : null);
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
      <button type="button" onClick={onBack} disabled={locked} className="disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] -ml-1 px-1 inline-flex items-center gap-1 text-sm text-theme-text-secondary hover:text-theme-text">
        <ArrowLeft size={16} aria-hidden="true" /> {t('aiOrder.cart.back')}
      </button>
      <h4 className="font-semibold text-theme-text text-base break-words">{shop.name}</h4>
      {email && (
        <div className="p-3 rounded-xl border border-theme-stroke bg-theme-surface space-y-1">
          <p className="text-sm text-theme-text flex items-start gap-2">
            <Mail size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>{t('aiOrder.email.intro', { shop: shop.name })}</span>
          </p>
          <p className="text-sm text-theme-text-secondary">
            {t('aiOrder.email.rules', {
              minHours: rules.min_lead_hours, maxDays: rules.max_lead_days, minPizzas: rules.min_pizzas, maxPizzas: rules.max_pizzas, maxTotal: formatCents(rules.max_total_cents),
            })}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Field id={ids.pickup} label={t('aiOrder.cart.pickupLabel')} help={<>{zoneLabel}<br />{t('aiOrder.cart.pickupOnly')}</>}>
          <IconInput
            id={ids.pickup}
            icon={Clock}
            type="datetime-local"
            value={pickupLocal}
            aria-describedby={leadText ? `${ids.pickup}-help ${ids.pickup}-lead` : `${ids.pickup}-help`}
            aria-invalid={!!leadProblem}
            onChange={(e) => setPickupLocal((e as React.ChangeEvent<HTMLInputElement>).target.value)}
          />
        </Field>
        {leadText && <p id={`${ids.pickup}-lead`} role="alert" className="text-sm text-[color:var(--ai-error)]">{leadText}</p>}
        <button
          type="button"
          className={`${cartState ? 'btn-secondary' : 'btn-primary'} w-full sm:w-auto text-sm min-h-[44px] py-2 px-4 flex items-center justify-center gap-2`}
          disabled={building || locked || !pickupIso || !!leadProblem}
          onClick={() => pickupIso && !leadProblem && onBuild(pickupIso)}
        >
          {building && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {cartState ? t('aiOrder.cart.rebuild') : t('aiOrder.cart.build')}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-[color:var(--ai-error)]">{error}</p>}
      {menuSlot}
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
                    disabled={building || locked || !pickupIso}
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
          {/* basil-14648 P2: say where the estimate comes from when it is the host's own menu */}
          {cartState?.cart?.menu?.provenance === 'host_provided' && (
            <p className="text-sm font-medium text-theme-text">
              {t('aiOrder.menu.using', { date: formatMenuDate(cartState.cart.menu.as_of, i18n.language, tz) })}
            </p>
          )}
          {quote.estimate ? (
            <p className="text-sm text-theme-text-secondary">
              {t('aiOrder.cart.estimate', { low: formatCents(quote.estimate.low_cents), high: formatCents(quote.estimate.high_cents), expected: formatCents(quote.estimate.expected_cents) })}
            </p>
          ) : (
            <p className="text-sm text-theme-text-secondary">{t('aiOrder.cart.total', { total: quote.total_display })}</p>
          )}
        </div>
      )}

      {quote && isPhone && !handoff && (
        <div className="space-y-2">
          <Field
            id={ids.ceiling}
            label={t('aiOrder.cart.limitLabel')}
            help={email && maxCeiling !== null
              ? t('aiOrder.email.limitHelp', { shop: shop.name, max: formatCents(maxCeiling) })
              : maxCeiling !== null
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
          {/* an email order is all as ordered: the shop confirms it or declines it, so no party deal */}
          {!email && <label htmlFor={ids.deals} className="flex items-start gap-3 min-h-[44px] py-1 cursor-pointer">
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
          </label>}
          {sizeText && <p role="alert" className="text-sm text-[color:var(--ai-error)]">{sizeText}</p>}
        </div>
      )}

      {handoff && handoffSlot}

      {quote && !handoff && (
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
            disabled={!ready || placing || locked || building}
            aria-describedby={missing ? `${uid}-missing` : undefined}
            onClick={() => e164 && onApprove({ ...(isPhone ? { ceilingCents } : {}), substitution: dealsOk && !email ? 'deals_ok' : 'exact', contact: { name: name.trim(), phone: e164 } })}
          >
            {placing && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {email ? t('aiOrder.email.approve', { shop: shop.name }) : isPhone ? t('aiOrder.cart.approve') : t('aiOrder.cart.continuePayment')}
          </button>
          {missing && <p id={`${uid}-missing`} className="text-sm text-theme-text">{missing}</p>}
          {approveError && <p ref={approveErrorRef} role="alert" className="text-sm text-[color:var(--ai-error)]">{approveError}</p>}
          {approveNotice}
          <p className="text-sm text-theme-text-secondary">
            {email ? t('aiOrder.email.next', { shop: shop.name }) : isPhone ? t('aiOrder.cart.nextPhone', { shop: shop.name }) : t('aiOrder.cart.nextNative')}
          </p>
        </div>
      )}

      {/* basil-14648 P2: the other channel, when it is open for this shop (the cart is built again for it) */}
      {!handoff && isPhone && onSwitchChannel && (email ? callable : !!emailAlt) && (
        <div className="pt-2 border-t border-theme-stroke space-y-2">
          <p className="text-sm text-theme-text-secondary">
            {email ? t('aiOrder.email.switchToCallIntro', { shop: shop.name }) : t('aiOrder.email.switchToEmailIntro', { shop: shop.name })}
          </p>
          <button
            type="button"
            className="btn-secondary w-full text-sm min-h-[44px] py-2 inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={locked || placing || building}
            onClick={() => onSwitchChannel(email ? 'ai_phone' : 'email')}
          >
            {email ? <Bot size={14} aria-hidden="true" /> : <Mail size={14} aria-hidden="true" />}
            {email ? t('aiOrder.email.switchToCall') : t('aiOrder.email.switchToEmail')}
          </button>
        </div>
      )}

      {!handoff && isPhone && onSwitchToHandoff && hasProviderLink(shop) && (
        <div className="pt-2 border-t border-theme-stroke space-y-2">
          <p className="text-sm text-theme-text-secondary">{t('aiOrder.handoff.orIntro')}</p>
          <button type="button" className="btn-secondary w-full text-sm min-h-[44px] py-2 inline-flex items-center justify-center gap-2" disabled={locked} onClick={onSwitchToHandoff}>
            <ShoppingBag size={14} aria-hidden="true" /> {t('aiOrder.handoff.switch')}
          </button>
        </div>
      )}
    </div>
  );
};
