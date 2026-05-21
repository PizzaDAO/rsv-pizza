import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePizza } from '../../contexts/PizzaContext';
import { BankDetails, PayoutMethod } from '../../types';
import {
  updateUserMe,
  getPaymentOptIn,
  submitPaymentOptIn,
  removePaymentOptIn,
} from '../../lib/api';
import { PayoutMethodPicker } from './PayoutMethodPicker';
import { isMercuryBlocked } from '../../lib/mercuryBlockedCountries';

const EMPTY_BANK: BankDetails = {};

// Loose email check — same shape used elsewhere in the app (e.g. invite forms).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * arugula-38633 v3: persistent "Payment details" card at the top of the
 * Payments tab. Hoists the per-receipt PayoutMethodPicker out of
 * NewPayoutForm so the host configures their payout method ONCE, then every
 * subsequent receipt submission reads from the saved user record.
 *
 * Persistence target: `users.preferred_payout_method`,
 * `users.payout_wallet_address`, `users.payout_bank_details` via
 * `PATCH /api/user/me`. AuthContext hydrates these on mount; we save through
 * `updateUserMe` and optimistically patch the local user via `setUser`.
 *
 * Save behavior: debounced 1s after the last change (mirrors
 * ExpectedGuestsCard's optimistic + auto-save pattern, but without the
 * explicit Save button — the picker UI is already interactive).
 */
export const PaymentDetailsCard: React.FC = () => {
  const { user, setUser } = useAuth();
  const { party } = usePizza();

  // Local mirrors of the user's persisted values. These drive PayoutMethodPicker
  // directly so the UI updates instantly; the debounced save flushes to the
  // backend ~1s after the host stops typing.
  const [method, setMethod] = useState<PayoutMethod | null>(
    user?.preferredPayoutMethod ?? null
  );
  const [walletAddress, setWalletAddress] = useState<string>(
    user?.payoutWalletAddress ?? ''
  );
  const [bankDetails, setBankDetails] = useState<BankDetails>(
    user?.payoutBankDetails ?? EMPTY_BANK
  );

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Resync local mirrors when AuthContext hydrates user payout prefs from
  // /api/user/me (the initial mount sees `user` from localStorage without
  // payout fields; the GET resolves a moment later).
  // Only resync when the user-record value differs from local — otherwise we'd
  // clobber in-flight edits. Done per-field for clarity.
  useEffect(() => {
    if (user?.preferredPayoutMethod !== undefined && method === null) {
      setMethod(user.preferredPayoutMethod ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.preferredPayoutMethod]);

  useEffect(() => {
    if (user?.payoutWalletAddress !== undefined && walletAddress === '') {
      setWalletAddress(user.payoutWalletAddress ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.payoutWalletAddress]);

  useEffect(() => {
    if (
      user?.payoutBankDetails !== undefined
      && !bankDetails.email
      && !bankDetails.accountHolderName
      && !bankDetails.bankName
    ) {
      setBankDetails(user.payoutBankDetails ?? EMPTY_BANK);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.payoutBankDetails]);

  // Validity mirror of NewPayoutForm's old methodValid — used to gate the
  // debounced save (don't push half-typed wire details to the backend).
  const methodValid = useMemo(() => {
    if (method == null) return false;
    if (method === 'usdc_base') {
      return /^0x[0-9a-fA-F]{40}$/.test(walletAddress.trim());
    }
    if (method === 'wire') {
      // arugula-38633 (follow-up): wire is now a single email field —
      // our bank emails the host to complete the transaction.
      const email = bankDetails.email?.trim() ?? '';
      return EMAIL_REGEX.test(email);
    }
    return true; // mercury_card has no extra required fields
  }, [method, walletAddress, bankDetails]);

  // Debounced auto-save. We track the "intended" payload in a ref so the
  // timeout callback always reads the latest values without re-creating the
  // timer on every keystroke. Mirror the cadence (1s) called for in the
  // task brief; ExpectedGuestsCard uses an explicit Save button so it doesn't
  // model debounce — PrepayCheckbox saves immediately (no debounce needed for
  // a single toggle). 1s feels right for free-form text.
  const saveTimer = useRef<number | null>(null);
  const isDirty = useRef(false);

  // Build the body that would be sent right now.
  const buildPayload = () => {
    if (method == null) return null;
    return {
      preferredPayoutMethod: method,
      payoutWalletAddress: method === 'usdc_base' ? walletAddress.trim() : null,
      payoutBankDetails: method === 'wire' ? bankDetails : null,
    };
  };

  // Track previous values so the auto-save only fires on actual change (not
  // on the initial setState from hydration).
  const prevSnapshot = useRef<string>(JSON.stringify({
    method: user?.preferredPayoutMethod ?? null,
    walletAddress: user?.payoutWalletAddress ?? '',
    bankDetails: user?.payoutBankDetails ?? EMPTY_BANK,
  }));

  useEffect(() => {
    const snapshot = JSON.stringify({ method, walletAddress, bankDetails });
    if (snapshot === prevSnapshot.current) return;
    prevSnapshot.current = snapshot;
    isDirty.current = true;

    // pepperoni-47301: never autosave `mercury_card` when the party's country
    // is on Mercury's restricted list — the per-party payout submission would
    // be rejected by the backend anyway. Surface the reason locally so the
    // host knows to pick another method.
    if (method === 'mercury_card' && isMercuryBlocked(party?.country)) {
      setSaveStatus('error');
      setSaveError(
        `Mercury cards are unavailable in ${party?.country ?? 'your country'}. Pick another method.`
      );
      return;
    }

    // Don't fire the save until the method-specific fields are valid.
    if (!methodValid) {
      setSaveStatus('pending');
      return;
    }

    setSaveStatus('pending');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const payload = buildPayload();
      if (!payload) return;
      setSaveStatus('saving');
      setSaveError(null);
      try {
        const updated = await updateUserMe(payload);
        // Optimistic context patch: merge new payout prefs into AuthContext.
        // Mirror the pattern used by ExpectedGuestsCard (loadParty) /
        // PrepayCheckbox (setParty) — here the equivalent is setUser, plus a
        // localStorage write so a refresh doesn't lose the values.
        setUser({
          ...(user as NonNullable<typeof user>),
          preferredPayoutMethod: updated.preferredPayoutMethod ?? null,
          payoutWalletAddress: updated.payoutWalletAddress ?? null,
          payoutBankDetails: updated.payoutBankDetails ?? null,
        });
        try {
          const stored = localStorage.getItem('user');
          const parsed = stored ? JSON.parse(stored) : {};
          localStorage.setItem('user', JSON.stringify({
            ...parsed,
            preferredPayoutMethod: updated.preferredPayoutMethod ?? null,
            payoutWalletAddress: updated.payoutWalletAddress ?? null,
            payoutBankDetails: updated.payoutBankDetails ?? null,
          }));
        } catch { /* quota — ignore */ }
        isDirty.current = false;
        setSaveStatus('saved');
        // Clear the "Saved" badge after a moment so it doesn't stick.
        window.setTimeout(() => {
          setSaveStatus(s => (s === 'saved' ? 'idle' : s));
        }, 1800);
      } catch (err: any) {
        setSaveStatus('error');
        setSaveError(err?.message || 'Failed to save payment details');
      }
    }, 1000);

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // We intentionally exclude buildPayload from deps — it closes over the
    // latest values via the surrounding effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, walletAddress, bankDetails, methodValid]);

  // PayoutMethodPicker requires non-null method. For the empty state we let
  // the user pick a method first; the picker still renders all three radios.
  const pickerMethod: PayoutMethod = method ?? 'mercury_card';

  // ============================================
  // bufala-83291: per-event payment opt-in
  // ============================================
  // The autosave above persists the user-LEVEL payout prefs (HOW to pay).
  // A separate opt-in row in `party_payment_opt_ins` controls WHETHER this
  // host should be considered a prepay candidate for THIS specific event.
  // Submitting on event X does not opt the host in on event Y.
  const partyId = party?.id ?? null;
  const partyName = party?.name ?? 'this event';
  const [optInLoaded, setOptInLoaded] = useState(false);
  const [optedIn, setOptedIn] = useState(false);
  const [optedInAt, setOptedInAt] = useState<string | null>(null);
  const [optInPending, setOptInPending] = useState(false);
  const [optInError, setOptInError] = useState<string | null>(null);

  // Hydrate opt-in state when the party becomes available.
  useEffect(() => {
    if (!partyId) {
      setOptInLoaded(false);
      setOptedIn(false);
      setOptedInAt(null);
      return;
    }
    let cancelled = false;
    setOptInLoaded(false);
    getPaymentOptIn(partyId)
      .then((res) => {
        if (cancelled) return;
        setOptedIn(res.optedIn);
        setOptedInAt(res.optedInAt);
        setOptInLoaded(true);
      })
      .catch(() => {
        // Soft-fail — the Submit button will surface a real error on click.
        if (cancelled) return;
        setOptInLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [partyId]);

  const optedInLabel = useMemo(() => {
    if (!optedInAt) return null;
    try {
      return new Date(optedInAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return null;
    }
  }, [optedInAt]);

  async function handleSubmitOptIn() {
    if (!partyId) return;
    setOptInPending(true);
    setOptInError(null);
    // If there's a debounced autosave still pending, flush it now so the user
    // record is up-to-date before we mark them as opted in. The autosave fires
    // ~1s after the last edit; we just cancel the timer and run the save inline.
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    try {
      if (isDirty.current && methodValid && method != null) {
        const payload = buildPayload();
        if (payload) {
          setSaveStatus('saving');
          const updated = await updateUserMe(payload);
          setUser({
            ...(user as NonNullable<typeof user>),
            preferredPayoutMethod: updated.preferredPayoutMethod ?? null,
            payoutWalletAddress: updated.payoutWalletAddress ?? null,
            payoutBankDetails: updated.payoutBankDetails ?? null,
          });
          isDirty.current = false;
          setSaveStatus('saved');
        }
      }
      const res = await submitPaymentOptIn(partyId);
      setOptedIn(true);
      setOptedInAt(res.optedInAt);
    } catch (err: any) {
      setOptInError(err?.message || 'Failed to submit payment details for this event');
    } finally {
      setOptInPending(false);
    }
  }

  async function handleRemoveOptIn() {
    if (!partyId) return;
    setOptInPending(true);
    setOptInError(null);
    try {
      await removePaymentOptIn(partyId);
      setOptedIn(false);
      setOptedInAt(null);
    } catch (err: any) {
      setOptInError(err?.message || 'Failed to remove opt-in');
    } finally {
      setOptInPending(false);
    }
  }

  // Submit is disabled until the host has picked a method and the
  // method-specific fields validate. Reuses the existing `methodValid` calc
  // so the gate matches the autosave gate.
  const submitDisabled = !partyId || optInPending || !methodValid;

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-theme-text">
            Payment details
          </h3>
        </div>
        <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
          {saveStatus === 'saving' && (
            <>
              <Loader2 size={12} className="animate-spin text-theme-text-muted" />
              <span className="text-theme-text-muted">Saving…</span>
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <Check size={12} className="text-emerald-500" />
              <span className="text-emerald-500">Saved</span>
            </>
          )}
          {saveStatus === 'pending' && method != null && (
            <span className="text-theme-text-muted">Editing…</span>
          )}
          {saveStatus === 'error' && (
            <>
              <AlertCircle size={12} className="text-[#ff393a]" />
              <span className="text-[#ff393a]">Save failed</span>
            </>
          )}
        </div>
      </div>

      <PayoutMethodPicker
        method={pickerMethod}
        onMethodChange={(next) => {
          setMethod(next);
          // When switching methods we DON'T wipe the other method's stored
          // details — they stay so the host can swap back without retyping.
        }}
        walletAddress={walletAddress}
        onWalletAddressChange={setWalletAddress}
        bankDetails={bankDetails}
        onBankDetailsChange={setBankDetails}
        userEmail={user?.email}
        reimbursementCapUsd={party?.effectiveReimbursementCapUsd ?? null}
      />

      {saveError && (
        <p className="text-xs text-[#ff393a] mt-2">{saveError}</p>
      )}

      {/*
        bufala-83291: per-event Submit. The autosave above keeps the user's
        global default in sync; this section ALSO opts them in for THIS event.
        Without an opt-in row the host won't appear on /payments as a prepay
        candidate even if their global payment method is set.
      */}
      {partyId && optInLoaded && (
        <div className="mt-5 border-t border-white/10 pt-4">
          {!optedIn ? (
            <div>
              <button
                type="button"
                onClick={handleSubmitOptIn}
                disabled={submitDisabled}
                className="btn-primary inline-flex items-center gap-2 text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {optInPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Submitting…
                  </>
                ) : (
                  'Submit my payment details for this event'
                )}
              </button>
              <p className="text-xs text-white/40 mt-2">
                Submitting opts you in to receive payment for {partyName}. You'll
                only be paid for events you submit for.
              </p>
              {!methodValid && (
                <p className="text-xs text-white/40 mt-1">
                  Choose a payout method above before submitting.
                </p>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 text-sm text-emerald-500">
                <Check size={16} />
                <span>
                  Submitted for {partyName}
                  {optedInLabel ? ` on ${optedInLabel}` : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={handleRemoveOptIn}
                disabled={optInPending}
                className="mt-2 text-xs text-white/50 hover:text-white/80 underline disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {optInPending ? 'Removing…' : "Remove me from this event's payments"}
              </button>
            </div>
          )}
          {optInError && (
            <p className="text-xs text-[#ff393a] mt-2">{optInError}</p>
          )}
        </div>
      )}
    </div>
  );
};
