import React from 'react';
import { CreditCard, Banknote, Coins, Mail, Wallet, ExternalLink, Loader2 } from 'lucide-react';
import { PayoutMethod, BankDetails } from '../../types';
import { IconInput } from '../IconInput';
import {
  resolveEnsName,
  fetchReimbursementOptions,
  ResolvedReimbursementOption,
} from '../../lib/api';
import { usePizza } from '../../contexts/PizzaContext';

// taleggio-30219: mirror of backend `looksLikeEnsName` — accepts dotted
// names like `vitalik.eth` or `alice.cb.id` and rejects 0x… inputs.
const ENS_NAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
function looksLikeEnsName(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || trimmed.startsWith('0x')) return false;
  return ENS_NAME_RE.test(trimmed);
}

// marinara-71630 P1: the backend decides which options the host sees. This
// array is a FALLBACK ONLY — used when the reimbursement-options fetch fails
// or returns [] (config not seeded yet, e.g. on preview before prod is
// seeded), so the picker never renders empty. The three built-in methods are
// shown all-enabled. Once config is seeded these come from the server instead.
const FALLBACK_OPTIONS: ResolvedReimbursementOption[] = [
  { id: 'usdc_base', label: 'USDC on Base', description: 'Onchain payment to your wallet.', kind: 'method', enabled: true },
  { id: 'mercury_card', label: 'Mercury virtual card', description: 'We issue you a debit card for the exact amount.', kind: 'method', enabled: true },
  { id: 'wire', label: 'Bank wire', description: 'We send a wire to your bank account.', kind: 'method', enabled: true },
];

// Icon per known method id. Unknown ids (future config-driven methods) get a
// neutral default so the picker stays robust.
const METHOD_ICONS: Record<string, React.ReactNode> = {
  usdc_base: <Coins size={18} />,
  mercury_card: <CreditCard size={18} />,
  wire: <Banknote size={18} />,
};

type EnsPreviewState =
  | { kind: 'idle' }
  | { kind: 'resolving'; name: string }
  | { kind: 'resolved'; name: string; address: string }
  | { kind: 'error'; name: string };

interface PayoutMethodPickerProps {
  method: PayoutMethod;
  onMethodChange: (method: PayoutMethod) => void;

  walletAddress: string;
  onWalletAddressChange: (v: string) => void;

  bankDetails: BankDetails;
  onBankDetailsChange: (b: BankDetails) => void;

  /** Email shown to user for the Mercury card destination + prefilled for wire. */
  userEmail?: string;
  /**
   * arugula-38633 (follow-up): the host's effective reimbursement cap. Used in
   * the Mercury copy so the host understands the card has a LIMIT, not a fixed
   * per-receipt amount. When null, we omit the dollar amount entirely.
   */
  reimbursementCapUsd?: number | null;
  /**
   * marinara-71630 P1: optional pre-resolved options. When provided, the picker
   * uses these instead of fetching (lets a parent — e.g. PaymentDetailsCard —
   * share a single fetch for both the picker UI and its save-guard). When
   * omitted, the picker fetches them itself.
   */
  options?: ResolvedReimbursementOption[] | null;
}

/**
 * Radio picker for payout method, with method-specific sub-form.
 *
 * marinara-71630 P1: the BACKEND now decides which options the host sees
 * (country/tag-driven private config); this component just renders them.
 *
 *   mercury_card → just a confirmation that we'll email a virtual card
 *   wire         → single email field (our bank emails the host to complete)
 *   usdc_base    → wallet address IconInput
 *
 * Options with `kind:'external'` (e.g. an SWC-hub card) are rendered as
 * non-selectable informational cards and never set `method`.
 */
export const PayoutMethodPicker: React.FC<PayoutMethodPickerProps> = ({
  method,
  onMethodChange,
  walletAddress,
  onWalletAddressChange,
  bankDetails,
  onBankDetailsChange,
  userEmail,
  reimbursementCapUsd,
  options: optionsProp,
}) => {
  const { party } = usePizza();
  const partyId = party?.id ?? null;

  // marinara-71630 P1: fetch server-decided options (unless a parent passed
  // them in). Falls back to the three built-in methods on failure/empty.
  const [fetchedOptions, setFetchedOptions] = React.useState<ResolvedReimbursementOption[] | null>(null);
  const [optionsLoading, setOptionsLoading] = React.useState(false);

  React.useEffect(() => {
    if (optionsProp !== undefined && optionsProp !== null) {
      // Parent supplies options; don't fetch (and don't leave the spinner stuck
      // if a self-fetch was already in flight when the prop arrived).
      setOptionsLoading(false);
      return;
    }
    if (!partyId) {
      setFetchedOptions(null);
      return;
    }
    let cancelled = false;
    setOptionsLoading(true);
    fetchReimbursementOptions(partyId)
      .then((opts) => {
        if (cancelled) return;
        // Empty (unseeded config) → fall back to the three built-in methods.
        setFetchedOptions(opts.length > 0 ? opts : FALLBACK_OPTIONS);
      })
      .catch(() => {
        if (cancelled) return;
        setFetchedOptions(FALLBACK_OPTIONS);
      })
      .finally(() => {
        if (cancelled) return;
        setOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [partyId, optionsProp]);

  // Resolve the options to render: parent-provided (fall back when empty) →
  // self-fetched → still loading.
  const options: ResolvedReimbursementOption[] | null =
    optionsProp !== undefined && optionsProp !== null
      ? (optionsProp.length > 0 ? optionsProp : FALLBACK_OPTIONS)
      : fetchedOptions;

  const methodOptions = (options ?? []).filter((o) => o.kind === 'method');
  const externalOptions = (options ?? []).filter((o) => o.kind === 'external');

  // stromboli-58518: when the host's saved method is no longer among the
  // OFFERED options (e.g. their saved preference is `wire` but config now only
  // returns usdc_base), fall back to the first enabled method so the picker
  // never renders a stale sub-form for an unavailable method.
  const enabledMethodIds = methodOptions.filter((o) => o.enabled).map((o) => o.id);
  const methodAvailable = enabledMethodIds.includes(method);
  const fallbackMethodId = enabledMethodIds[0];
  const effectiveMethod = (methodAvailable ? method : (fallbackMethodId ?? method)) as PayoutMethod;

  // stromboli-58518: migrate the saved selection forward when it's unavailable.
  React.useEffect(() => {
    if (options === null) return;            // options still loading
    if (methodOptions.length === 0) return;  // nothing selectable
    if (methodAvailable) return;             // saved method is still offered
    if (!fallbackMethodId) return;
    onMethodChange(fallbackMethodId as PayoutMethod);
    // onMethodChange is a stable-enough parent setter; re-running per render is
    // guarded by methodAvailable, so exclude it from deps to avoid churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, method]);

  // girasole-58537: when there is exactly one method option (rendered as a
  // static card, not a radio), auto-select it so the wallet sub-form shows and
  // the parent save-guard passes. Only when it's enabled and differs from the
  // current selection (guarded against a render loop). Never auto-select a
  // disabled lone option.
  const loneMethod = methodOptions.length === 1 ? methodOptions[0] : null;
  React.useEffect(() => {
    if (!loneMethod) return;
    if (!loneMethod.enabled) return;
    if (method === loneMethod.id) return;
    onMethodChange(loneMethod.id as PayoutMethod);
    // onMethodChange excluded intentionally; guarded by the id comparison above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loneMethod?.id, loneMethod?.enabled, method]);

  // taleggio-30219: debounced ENS preview state for the USDC sub-form.
  const [ensPreview, setEnsPreview] = React.useState<EnsPreviewState>({ kind: 'idle' });
  React.useEffect(() => {
    if (effectiveMethod !== 'usdc_base') {
      setEnsPreview({ kind: 'idle' });
      return;
    }
    const trimmed = walletAddress.trim();
    if (!trimmed || !looksLikeEnsName(trimmed)) {
      setEnsPreview({ kind: 'idle' });
      return;
    }
    setEnsPreview({ kind: 'resolving', name: trimmed });
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      const addr = await resolveEnsName(trimmed);
      if (cancelled) return;
      if (addr) {
        setEnsPreview({ kind: 'resolved', name: trimmed, address: addr });
      } else {
        setEnsPreview({ kind: 'error', name: trimmed });
      }
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [effectiveMethod, walletAddress]);

  // For wire: prefill the field from the user's auth email if no saved value.
  // We mirror this into bankDetails on first render of the wire branch so the
  // auto-save persists it even if the host doesn't touch the field.
  const wireEmail = bankDetails.email ?? userEmail ?? '';
  React.useEffect(() => {
    if (effectiveMethod !== 'wire') return;
    if (bankDetails.email !== undefined) return; // already set (incl. empty string)
    if (!userEmail) return;
    onBankDetailsChange({ ...bankDetails, email: userEmail });
    // We only want to seed on the first transition into wire mode; deps below
    // intentionally exclude bankDetails/onBankDetailsChange so we don't loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMethod, userEmail]);

  const Option: React.FC<{
    value: PayoutMethod;
    icon: React.ReactNode;
    title: string;
    description: string;
    disabled?: boolean;
    disabledReason?: string;
  }> = ({ value, icon, title, description, disabled, disabledReason }) => {
    const active = effectiveMethod === value;
    return (
      <button
        type="button"
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onClick={() => {
          if (disabled) return;
          onMethodChange(value);
        }}
        className={`w-full text-left rounded-xl border p-4 transition-colors ${
          disabled
            ? 'border-theme-stroke bg-theme-surface opacity-60 cursor-not-allowed'
            : active
              ? 'border-[#ff393a] bg-[#ff393a]/5'
              : 'border-theme-stroke bg-theme-surface hover:border-theme-stroke-strong'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 ${active && !disabled ? 'text-[#ff393a]' : 'text-theme-text-muted'}`}>
            {icon}
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-theme-text">{title}</div>
            <div className="text-xs text-theme-text-muted mt-0.5">{description}</div>
            {disabled && disabledReason && (
              <div className="text-[10px] text-amber-300 mt-1">{disabledReason}</div>
            )}
          </div>
          <div
            className={`mt-1 w-4 h-4 rounded-full border-2 flex-shrink-0 ${
              active && !disabled ? 'border-[#ff393a]' : 'border-theme-stroke'
            }`}
          >
            {active && !disabled && <div className="w-2 h-2 rounded-full bg-[#ff393a] m-0.5" />}
          </div>
        </div>
      </button>
    );
  };

  if (options === null) {
    // Still loading the server-decided options.
    return (
      <div className="flex items-center gap-2 text-sm text-theme-text-muted py-4">
        <Loader2 size={16} className="animate-spin" />
        <span>Loading payout options…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/*
        girasole-58537: a single payment option isn't a choice — render it as a
        static, non-interactive card (icon + label + description) with no radio
        circle and no button/click/hover affordance. The auto-select effect
        above keeps `method` in sync so the sub-form + save-guard work.
      */}
      {methodOptions.length === 1 && (() => {
        const opt = methodOptions[0];
        const disabled = !opt.enabled;
        return (
          <div
            className={`w-full rounded-xl border p-4 ${
              disabled
                ? 'border-theme-stroke bg-theme-surface opacity-60'
                : 'border-[#ff393a] bg-[#ff393a]/5'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 ${disabled ? 'text-theme-text-muted' : 'text-[#ff393a]'}`}>
                {METHOD_ICONS[opt.id] ?? <Coins size={18} />}
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-theme-text">{opt.label}</div>
                <div className="text-xs text-theme-text-muted mt-0.5">{opt.description ?? ''}</div>
                {disabled && opt.disabledReason && (
                  <div className="text-[10px] text-amber-300 mt-1">{opt.disabledReason}</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {methodOptions.length > 1 && (
        <div
          className={`grid gap-3 ${
            methodOptions.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
          }`}
        >
          {methodOptions.map((opt) => (
            <Option
              key={opt.id}
              value={opt.id as PayoutMethod}
              icon={METHOD_ICONS[opt.id] ?? <Coins size={18} />}
              title={opt.label}
              description={opt.description ?? ''}
              disabled={!opt.enabled}
              disabledReason={opt.disabledReason}
            />
          ))}
        </div>
      )}

      {/*
        marinara-71630 P1: external (informational) options — e.g. an SWC-hub
        card. NOT selectable payout methods: they never set `method`. Render
        label + description, plus an external link when a url is configured.
      */}
      {externalOptions.map((opt) => (
        <div
          key={opt.id}
          className="rounded-xl border border-theme-stroke bg-theme-surface p-4"
        >
          <div className="text-sm font-semibold text-theme-text">{opt.label}</div>
          {opt.description && (
            <div className="text-xs text-theme-text-muted mt-1">{opt.description}</div>
          )}
          {opt.url && (
            <a
              href={opt.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#ff393a] hover:underline"
            >
              Learn more
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      ))}

      {optionsLoading && (
        <div className="flex items-center gap-2 text-xs text-theme-text-muted">
          <Loader2 size={12} className="animate-spin" />
          <span>Updating options…</span>
        </div>
      )}

      {effectiveMethod === 'mercury_card' && (
        <div className="rounded-xl border border-theme-stroke bg-theme-surface p-4 text-sm text-theme-text-secondary">
          <p>
            We'll issue you a Mercury virtual debit card
            {typeof reimbursementCapUsd === 'number' && reimbursementCapUsd > 0 ? (
              <>
                {' '}with a limit of{' '}
                <span className="text-theme-text font-semibold">${reimbursementCapUsd.toFixed(2)}</span>
              </>
            ) : null}
            .
          </p>
        </div>
      )}

      {effectiveMethod === 'usdc_base' && (
        <div className="space-y-2">
          <IconInput
            icon={Wallet}
            type="text"
            placeholder="Your wallet address or ENS name (0x… or alice.eth)"
            value={walletAddress}
            onChange={e => onWalletAddressChange(e.target.value)}
            required
          />
          {/* taleggio-30219: live ENS preview. Hidden when the input is 0x or empty. */}
          {ensPreview.kind === 'resolving' && (
            <p className="text-xs text-theme-text-muted">
              Resolving <span className="font-mono">{ensPreview.name}</span>…
            </p>
          )}
          {ensPreview.kind === 'resolved' && (
            <p className="text-xs text-theme-text-muted">
              → <span className="font-mono">{ensPreview.address.slice(0, 6)}…{ensPreview.address.slice(-4)}</span>
            </p>
          )}
          {ensPreview.kind === 'error' && (
            <p className="text-xs text-red-400">
              Could not resolve "<span className="font-mono">{ensPreview.name}</span>"
            </p>
          )}
          <p className="text-xs text-theme-text-muted">
            USDC on Base ({/* link omitted intentionally */}
            <span className="font-mono">0x8335…2913</span>). ENS names resolve against Ethereum mainnet. Double-check the resolved address — onchain transfers can't be reversed.
          </p>
        </div>
      )}

      {effectiveMethod === 'wire' && (
        <div className="space-y-2">
          <IconInput
            icon={Mail}
            type="email"
            placeholder="Email for bank correspondence"
            value={wireEmail}
            onChange={e => onBankDetailsChange({ ...bankDetails, email: e.target.value })}
            required
          />
          <p className="text-xs text-theme-text-muted">
            We'll send you an email from our bank to complete the transaction.
          </p>
        </div>
      )}
    </div>
  );
};
