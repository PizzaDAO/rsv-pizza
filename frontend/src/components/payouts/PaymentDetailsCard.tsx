import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePizza } from '../../contexts/PizzaContext';
import { BankDetails, PayoutMethod } from '../../types';
import { updateUserMe } from '../../lib/api';
import { PayoutMethodPicker } from './PayoutMethodPicker';

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

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-theme-text">
            Payment details
          </h3>
          <p className="text-xs text-theme-text-muted mt-1">
            How do you want to be paid when your receipts are approved? We'll save
            this for every future receipt.
          </p>
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
    </div>
  );
};
