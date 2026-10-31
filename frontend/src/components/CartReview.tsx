import React, { useMemo, useState } from 'react';
import { Loader2, Clock, DollarSign, User, Phone } from 'lucide-react';
import { IconInput } from './IconInput';
import { Checkbox } from './Checkbox';
import { CartResponse, PizzaShop, formatCents, toE164, defaultPickupLocal } from '../lib/pizzaOrder';

interface CartReviewProps {
  shop: PizzaShop;
  /** Null until the first cart build. */
  cartState: CartResponse | null;
  building: boolean;
  error: string | null;
  defaultName: string;
  partyDate: string | null;
  onBuild: (pickupAtIso: string) => void;
  onApprove: (input: { ceilingCents: number; substitution: 'exact' | 'deals_ok'; contact: { name: string; phone: string } }) => void;
  placing: boolean;
  onBack: () => void;
}

export const CartReview: React.FC<CartReviewProps> = ({
  shop, cartState, building, error, defaultName, partyDate, onBuild, onApprove, placing, onBack,
}) => {
  const [pickupLocal, setPickupLocal] = useState(() => defaultPickupLocal(partyDate));
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState('');
  const [dealsOk, setDealsOk] = useState(false);
  const [ceilingText, setCeilingText] = useState<string | null>(null);

  const quote = cartState?.quote ?? null;
  const isPhone = shop.tier !== 'native';
  const maxCeiling = useMemo(() => {
    const caps = [quote?.price_ceiling_cents, cartState?.capCents].filter((c): c is number => typeof c === 'number');
    return caps.length ? Math.min(...caps) : null;
  }, [quote, cartState]);

  const ceilingCents = ceilingText !== null ? Math.round(Number(ceilingText) * 100) : maxCeiling ?? 0;
  const ceilingOk = !isPhone || (ceilingCents > 0 && (maxCeiling === null || ceilingCents <= maxCeiling));
  const e164 = toE164(phone);
  const pickupIso = (() => {
    const d = new Date(pickupLocal);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  })();
  const ready = !!quote && !cartState?.issues.length && ceilingOk && !!e164 && name.trim().length > 0;

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-xs text-theme-text-muted hover:text-theme-text">
        &larr; Pick a different pizzeria
      </button>
      <h4 className="font-medium text-theme-text text-sm">{shop.name}</h4>

      <div className="space-y-2">
        <IconInput
          icon={Clock}
          type="datetime-local"
          value={pickupLocal}
          onChange={(e) => setPickupLocal((e as React.ChangeEvent<HTMLInputElement>).target.value)}
          placeholder="Pickup time"
        />
        <p className="text-xs text-theme-text-faint">Pickup only. You pay at the counter and get reimbursed through your receipts.</p>
        <button
          type="button"
          className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-2"
          disabled={building || !pickupIso}
          onClick={() => pickupIso && onBuild(pickupIso)}
        >
          {building && <Loader2 size={14} className="animate-spin" />}
          {cartState ? 'Rebuild order' : 'Build order from recommendations'}
        </button>
      </div>

      {error && <p className="text-sm text-[#ff393a]">{error}</p>}

      {cartState?.issues.length ? (
        <div className="p-3 rounded-xl border border-[#ffb347]/40 bg-[#ffb347]/5 space-y-2">
          <p className="text-sm font-medium text-theme-text">This shop's menu needs your help</p>
          {cartState.issues.map((i) => (
            <p key={i.ref} className="text-xs text-theme-text-secondary">
              &quot;{i.text}&quot;: {i.ask_user}
              {i.candidates.length > 0 && ` (${i.candidates.join(', ')})`}
            </p>
          ))}
          <p className="text-xs text-theme-text-muted">Try another pizzeria, or call this one yourself.</p>
        </div>
      ) : null}

      {quote && (
        <div className="p-3 bg-theme-surface rounded-xl border border-theme-stroke space-y-2">
          <p className="text-xs uppercase tracking-wide text-theme-text-muted">We will order exactly this</p>
          <p className="text-sm text-theme-text whitespace-pre-line">{quote.read_back}</p>
          {quote.estimate ? (
            <p className="text-sm text-theme-text-secondary">
              Estimate {formatCents(quote.estimate.low_cents)} to {formatCents(quote.estimate.high_cents)}
              <span className="text-theme-text-faint"> (usually about {formatCents(quote.estimate.expected_cents)}, {quote.estimate.confidence} confidence). The shop's total on the call is the real price.</span>
            </p>
          ) : (
            <p className="text-sm text-theme-text-secondary">Total {quote.total_display}</p>
          )}
        </div>
      )}

      {quote && isPhone && (
        <div className="space-y-2">
          <IconInput
            icon={DollarSign}
            inputMode="decimal"
            value={ceilingText ?? (maxCeiling ? (maxCeiling / 100).toFixed(2) : '')}
            onChange={(e) => setCeilingText((e as React.ChangeEvent<HTMLInputElement>).target.value)}
            placeholder="Most the AI may accept (USD)"
          />
          <p className="text-xs text-theme-text-faint">
            {maxCeiling !== null
              ? `Up to ${formatCents(maxCeiling)}${cartState?.capCents ? ` (your reimbursement cap is ${formatCents(cartState.capCents)})` : ''}. If the shop says more, we ask you first.`
              : 'If the shop says more, we ask you first.'}
          </p>
          {!ceilingOk && <p className="text-xs text-[#ff393a]">Enter an amount up to {formatCents(maxCeiling)}.</p>}
          <Checkbox
            checked={dealsOk}
            onChange={() => setDealsOk((v) => !v)}
            label="Allow a party deal if the pizza count stays the same and the total stays under my limit"
            size={16}
            labelClassName="text-xs text-theme-text-secondary"
          />
        </div>
      )}

      {quote && (
        <div className="space-y-2">
          <IconInput icon={User} value={name} onChange={(e) => setName((e as React.ChangeEvent<HTMLInputElement>).target.value)} placeholder="Pickup name" />
          <IconInput icon={Phone} type="tel" value={phone} onChange={(e) => setPhone((e as React.ChangeEvent<HTMLInputElement>).target.value)} placeholder="Your mobile number, e.g. (617) 555-0123" />
          {phone && !e164 && <p className="text-xs text-[#ff393a]">Use a full number with area code.</p>}
          <button
            type="button"
            className="btn-primary w-full text-sm py-2 flex items-center justify-center gap-2"
            disabled={!ready || placing}
            onClick={() => e164 && onApprove({ ceilingCents, substitution: dealsOk ? 'deals_ok' : 'exact', contact: { name: name.trim(), phone: e164 } })}
          >
            {placing && <Loader2 size={14} className="animate-spin" />}
            {isPhone ? 'Approve and have the AI call' : 'Continue to payment'}
          </button>
          <p className="text-xs text-theme-text-faint">
            A new tab opens where you enter a code we email you. Nothing is ordered until you do.
          </p>
        </div>
      )}
    </div>
  );
};
