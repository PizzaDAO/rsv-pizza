import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  DollarSign,
  Pencil,
  Loader2,
  CreditCard,
  Coins,
  Banknote,
  AlertTriangle,
  Star,
  Hash,
  Wallet,
  Mail,
  Send,
} from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { SwcHubWarning } from './SwcHubWarning';
import { isMercuryBlocked } from '../../lib/mercuryBlockedCountries';
import {
  approveAdminPayout,
  createPayout,
  executeAdminPayout,
  fetchWalletPaidTotal,
  searchApprovedParties,
  type ApprovedPartySearchResult,
} from '../../lib/api';
import { usePayoutCaps } from '../../hooks/usePayoutCaps';
import { useSwcHubRules } from '../../hooks/useSwcHubRules';
import type { PayoutMethod, WalletPaidTotal } from '../../types';

/**
 * salame-92106: admin modal to ACTIVELY SEND a payment from rsv.pizza's
 * payment infrastructure (USDC on Base via the hot wallet, wire confirmation,
 * Mercury card) — distinct from `ExternalPaymentModal` (logs an off-platform
 * payment that already happened) and `MarkPartyPaidModal` (flips already-in-
 * flight payouts to paid).
 *
 * Opened from the city-level Actions menu in `PayoutsByPartyTable`. The
 * partyId + city name + outstanding total + country + cap + paid-so-far are
 * passed in by the parent so the form pre-fills sensibly.
 *
 * Backend strategy (option A per the plan): create a payout via the existing
 *   POST /api/parties/:partyId/payouts (recipientHostUserId override),
 * approve it via POST /api/admin/payouts/:id/approve, and execute via
 *   POST /api/admin/payouts/:id/execute (or autoExecute on approve for USDC).
 * Two-row audit chain (create + execute) — that's the trade-off for not
 * needing a new atomic endpoint, and it's GOOD for traceability.
 *
 * marinara-71630 P6 — the per-submission cap is no longer hardcoded here; it's
 * fetched from `app_config` (private.payout_caps) via `usePayoutCaps`. While the
 * cap is unknown (loading / fetch failure) the neutral fallback is
 * `Number.POSITIVE_INFINITY`, so the amber warning simply doesn't fire until the
 * real value loads. The backend enforces the cap regardless.
 */

interface SendPaymentModalProps {
  partyId: string;
  partyName: string;
  /**
   * Outstanding total (Approved - Paid). Kept for the helper-text display
   * under the amount field, but no longer drives the default amount —
   * gnocchi-92105 switched the pre-fill to receipts_total - paid_total so
   * the admin sees "what the city actually spent minus what we've paid"
   * rather than "what host claims add up to minus what's been paid."
   */
  outstandingUsd: number;
  /**
   * gnocchi-92105: sum of non-duplicate, eligible receipt OCR USD values
   * across the party's payouts. Together with `paidTotalUsd` this drives
   * the default amount = max(0, receiptsTotal - paidTotal). No cap clamp.
   */
  receiptsTotalUsd: number;
  /** Optional — when present, drives the per-party cap warning + Mercury gate. */
  country: string | null;
  /** Optional — drives SWC-Hub warning via isSwcHubParty (country/tags). */
  eventTags?: string[];
  /** Optional — resolved reimbursement cap. Null = uncapped. */
  effectiveReimbursementCapUsd: number | null;
  /** Optional — already-paid total for this party. Drives the cap-remaining math. */
  paidTotalUsd: number;
  /** Optional — primary host User id (parties.userId). Pre-selects recipient. */
  primaryHostUserId?: string | null;
  /**
   * Map of recipient User id -> the USDC wallet that host submitted on their
   * receipt payouts for this city (ENS input preferred over the resolved 0x).
   * Used to pre-fill the wallet field when a recipient is selected so the
   * admin doesn't have to re-type the address the host already gave us.
   */
  hostWalletByUserId?: Record<string, string>;
  /**
   * bufalina-60733: fake-detection risk for this party (looked up by the
   * parent from the by-city score map at open time). When `fakeTier` is
   * `medium`/`high`, the modal shows a caution card and gates "Send" behind
   * an extra ack. Undefined / clean / low = no gate.
   */
  fakeScore?: number;
  fakeTier?: string;
  fakeTopFlags?: string[];
  onClose: () => void;
  /**
   * Called on a successful send. Receives the city name + method + amount so
   * the parent can render a toast like "Sent USDC payment of $X to Y".
   */
  onSent: (summary: { partyName: string; method: PayoutMethod; amountUsd: number }) => void;
}

type Method = PayoutMethod; // 'usdc_base' | 'wire' | 'mercury_card'

function stripGppPrefix(name: string): string {
  return name.replace(/^Global Pizza Party\s+/i, '');
}

export const SendPaymentModal: React.FC<SendPaymentModalProps> = ({
  partyId,
  partyName,
  outstandingUsd,
  receiptsTotalUsd,
  country,
  eventTags,
  effectiveReimbursementCapUsd,
  paidTotalUsd,
  primaryHostUserId,
  hostWalletByUserId,
  fakeScore,
  fakeTier,
  fakeTopFlags,
  onClose,
  onSent,
}) => {
  // Hooks-above-early-returns: all useState / useEffect / useMemo live up
  // front so adding a conditional return below can't change hook order.
  // (feedback_hooks_above_early_returns)
  const cleanName = useMemo(() => stripGppPrefix(partyName), [partyName]);

  // marinara-71630 P6 — per-submission cap from private config (was hardcoded
  // in the bundle). Neutral fallback while loading/on error → warning is inert.
  const { caps: payoutCaps } = usePayoutCaps();
  // marinara-71630 P7: SWC-hub country/tag rules from config (same payments-admin
  // endpoint as the caps). The local memo below applies the SAME looser
  // (case-insensitive) matching this modal has always used, now against the
  // configured rule values. While unresolved (null) nothing is flagged SWC.
  const { rules: swcHubRules } = useSwcHubRules();
  const perSubmissionMaxUsd =
    payoutCaps?.perSubmissionMaxUsd ?? Number.POSITIVE_INFINITY;

  // Load the host-candidate list for this party via the existing
  // `parties/search` endpoint. We search by the cleaned city name and
  // auto-pick the row matching `partyId`. The endpoint returns name/email/role
  // for the primary host + cohosts whose email maps to a User.
  const [partyMeta, setPartyMeta] = useState<ApprovedPartySearchResult | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCandidatesLoading(true);
    setCandidatesError(null);
    (async () => {
      try {
        // Search by stripped city name. If multiple events share the same
        // name we filter down to `partyId` below; otherwise the auto-pick
        // works on the single result.
        const results = await searchApprovedParties(cleanName);
        if (cancelled) return;
        const match = results.find((r) => r.id === partyId) ?? null;
        if (!match) {
          setCandidatesError(
            "Couldn't load recipients for this city — try again or use Add external payment.",
          );
        } else {
          setPartyMeta(match);
        }
      } catch (err: any) {
        if (!cancelled) {
          setCandidatesError(err?.message || 'Failed to load recipients');
        }
      } finally {
        if (!cancelled) setCandidatesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cleanName, partyId]);

  // Recipient pick — defaults to the primary host id when the candidates
  // load. Falls back to the first candidate when no primaryHostUserId match.
  const [recipientUserId, setRecipientUserId] = useState<string>('');

  useEffect(() => {
    if (!partyMeta) return;
    if (recipientUserId) return; // don't clobber a manual pick
    const primaryMatch = primaryHostUserId
      ? partyMeta.hostCandidates.find((c) => c.userId === primaryHostUserId)
      : null;
    const next =
      primaryMatch?.userId ??
      partyMeta.hostCandidates.find((c) => c.role === 'host')?.userId ??
      partyMeta.hostCandidates[0]?.userId ??
      '';
    setRecipientUserId(next);
  }, [partyMeta, primaryHostUserId, recipientUserId]);

  // gnocchi-92105: amount default is now receipts_total - paid_total —
  // straight subtraction, NOT clamped by cap and NOT clamped by Outstanding.
  // If negative (overpaid), defaults to $0. The per-submission ceiling is
  // still enforced downstream via `exceedsPerSubmission`; we don't pre-clamp
  // here because Snax wanted the raw subtraction visible.
  const defaultAmount = useMemo(() => {
    const raw = receiptsTotalUsd - paidTotalUsd;
    const clamped = Math.max(0, raw);
    return clamped > 0 ? clamped.toFixed(2) : '';
  }, [receiptsTotalUsd, paidTotalUsd]);
  const [amountStr, setAmountStr] = useState(defaultAmount);

  const [method, setMethod] = useState<Method>('usdc_base');
  const [note, setNote] = useState('');

  // Destination details (per-method).
  const [walletAddress, setWalletAddress] = useState('');
  const [bankEmail, setBankEmail] = useState('');
  const [mercuryCardLast4, setMercuryCardLast4] = useState('');
  const [mercuryCardId, setMercuryCardId] = useState('');
  const [wireReference, setWireReference] = useState('');

  // Pre-fill the USDC wallet with the address the selected host submitted on
  // their receipt payouts for this city (passed down per-recipient by the
  // parent). Re-runs whenever the recipient changes so switching hosts pulls
  // in that host's wallet; an empty mapping clears the field. `hostWalletByUserId`
  // is a stable snapshot for the modal's lifetime, so this only fires on an
  // actual recipient change — a manual edit for the same recipient is kept.
  useEffect(() => {
    if (!recipientUserId) return;
    setWalletAddress(hostWalletByUserId?.[recipientUserId] ?? '');
  }, [recipientUserId, hostWalletByUserId]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // soppressata-49320: persist the pending payout id created in step 1 across
  // retries so a Send that fails at approve/execute (step 2/3) can re-drive the
  // SAME row instead of creating a second orphaned `pending` row on the next
  // click. Re-driving is safe: approve on a `pending` row is the normal
  // transition, and the backend executePayout accepts an `approved` OR
  // previously-`failed` row and excludes the row's own id from the party-cap
  // check, so it never double-sends or double-counts. Reset to null on full
  // success and whenever the form inputs that define the row change (below).
  const createdPayoutIdRef = useRef<string | null>(null);

  // Cap-override ack (salame-92103 pattern). Reset when amount or party
  // changes so a stale ack doesn't carry across edits.
  const [overridePartyCap, setOverridePartyCap] = useState(false);

  // guanciale-49340: per-address $676 cap warning state (mirrors bianco-89172
  // in PayoutReviewModal). `walletPaidTotal` holds the recipient wallet's
  // cumulative paid-USDC total + would-exceed check for the in-flight amount;
  // `overridePerAddressCap` is the admin's ack, required to enable Send when
  // `wouldExceed === true`. Only relevant for the usdc_base method.
  const [walletPaidTotal, setWalletPaidTotal] = useState<WalletPaidTotal | null>(null);
  const [walletPaidLoading, setWalletPaidLoading] = useState(false);
  const [overridePerAddressCap, setOverridePerAddressCap] = useState(false);

  // SWC Hub ack — controlled, surfaced via the shared SwcHubWarning component.
  const [swcAck, setSwcAck] = useState(false);

  // bufalina-60733: fake-detection ack. Required before sending when this party
  // scored medium/high. Reset on recipient/amount change like the other acks.
  const [fakeAck, setFakeAck] = useState(false);
  const isFlagged = fakeTier === 'medium' || fakeTier === 'high';

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const amountNum = useMemo(() => Number(amountStr), [amountStr]);

  // soppressata-49320 correctness guard: if the admin EDITS any input that
  // defines the payout row after a failed attempt, invalidate the persisted
  // id so the next submit creates a FRESH row matching the new inputs. Without
  // this, a retry after an edit would re-drive the stale row with the OLD
  // amount/recipient/method/destination — paying the wrong thing.
  useEffect(() => {
    createdPayoutIdRef.current = null;
  }, [recipientUserId, method, amountNum, walletAddress, bankEmail, mercuryCardLast4]);

  // bufalina-60733: reset the fake-detection ack whenever the recipient or
  // amount changes, so an ack made for one recipient/amount can't carry over
  // to a different one (mirrors the cap/SWC ack-reset intent).
  useEffect(() => {
    setFakeAck(false);
  }, [recipientUserId, amountNum]);

  // guanciale-49340: reset the per-address cap ack whenever the amount /
  // recipient / wallet / method changes (mirrors the per-party + fake acks),
  // so a stale acknowledgement can't carry across edits to a different send.
  useEffect(() => {
    setOverridePerAddressCap(false);
  }, [amountNum, recipientUserId, walletAddress, method]);

  // guanciale-49340: debounced per-address paid-total fetch (bianco-89172
  // pattern). When sending USDC to a syntactically-valid 0x wallet with a
  // finite positive amount, look up that wallet's cumulative paid total +
  // would-exceed check so we can warn before the backend rejects at the
  // $676 hard cap. Clears the warning state whenever it isn't applicable.
  useEffect(() => {
    const wallet = walletAddress.trim();
    if (
      method !== 'usdc_base' ||
      !/^0x[0-9a-fA-F]{40}$/.test(wallet) ||
      !Number.isFinite(amountNum) ||
      amountNum <= 0
    ) {
      setWalletPaidTotal(null);
      setWalletPaidLoading(false);
      return;
    }
    let cancelled = false;
    setWalletPaidLoading(true);
    const t = setTimeout(async () => {
      try {
        const total = await fetchWalletPaidTotal(wallet, amountNum);
        if (!cancelled) setWalletPaidTotal(total);
      } catch {
        if (!cancelled) setWalletPaidTotal(null);
      } finally {
        if (!cancelled) setWalletPaidLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [method, walletAddress, amountNum]);

  // Cap math (salame-92103 mirror). Cap remaining = cap - already-paid. We
  // also include this in-flight amount in `wouldExceed` so the warning fires
  // BEFORE the backend rejects at approve-time.
  const capRemaining =
    effectiveReimbursementCapUsd != null
      ? Math.max(0, effectiveReimbursementCapUsd - paidTotalUsd)
      : null;
  const partyWouldExceedCap =
    effectiveReimbursementCapUsd != null &&
    Number.isFinite(amountNum) &&
    paidTotalUsd + amountNum > effectiveReimbursementCapUsd + 1e-9;
  const partyOverBy =
    partyWouldExceedCap && effectiveReimbursementCapUsd != null
      ? Math.max(0, paidTotalUsd + amountNum - effectiveReimbursementCapUsd)
      : 0;

  // SWC Hub derivation — mirrors isSwcHubParty's two-input shape, but keeps this
  // modal's historically LOOSER (case-insensitive) matching: country matched
  // case-insensitively/trimmed, tag matched via case-insensitive `includes`.
  // marinara-71630 P7: the country/tag/exclude literals now come from config
  // (swcHubRules) instead of being hardcoded. The normalization below is
  // UNCHANGED so behavior is preserved; null rules → not-SWC (safe default).
  const swcHub = useMemo(() => {
    if (!swcHubRules) return false;
    const tags = eventTags ?? [];
    const excludeTags = swcHubRules.excludeTags ?? [];
    // marzano-58293: an exclude tag (e.g. 'nonhub') opts the party out of the
    // SWC Hub gate (USDC treatment) — precedence over the country + tag signals.
    if (
      excludeTags.length > 0 &&
      tags.some(
        (t) => t && excludeTags.includes(t.trim().toLowerCase()),
      )
    ) {
      return false;
    }
    const countries = (swcHubRules.countries ?? []).map((c) => c.trim().toLowerCase());
    if (country && countries.includes(country.trim().toLowerCase())) return true;
    const ruleTags = (swcHubRules.tags ?? []).map((t) => t.toLowerCase());
    return tags.some((t) => t && ruleTags.some((rt) => t.toLowerCase().includes(rt)));
  }, [country, eventTags, swcHubRules]);

  // Mercury blocked-country gate — same source as CreatePrepaymentModal
  // (pepperoni-47301). Disables the Mercury option, doesn't bypass.
  const mercuryBlocked = isMercuryBlocked(country);

  // Per-submission ceiling.
  const exceedsPerSubmission =
    Number.isFinite(amountNum) && amountNum > perSubmissionMaxUsd;

  // Per-method destination validity.
  const usdcValid = method !== 'usdc_base' || walletAddress.trim().length > 0;
  const wireValid = method !== 'wire' || wireReference.trim().length > 0;
  const mercuryValid =
    method !== 'mercury_card' || /^\d{4}$/.test(mercuryCardLast4.trim());

  const canSubmit =
    !!recipientUserId &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    !exceedsPerSubmission &&
    usdcValid &&
    wireValid &&
    mercuryValid &&
    // Mercury blocked = method disabled, but defensively gate Submit too.
    !(method === 'mercury_card' && mercuryBlocked) &&
    // salame-92103: cap-exceed requires explicit ack.
    (!partyWouldExceedCap || overridePartyCap) &&
    // guanciale-49340: per-address $676 cap-exceed requires explicit ack.
    (!(walletPaidTotal?.wouldExceed) || overridePerAddressCap) &&
    // parmigiana-92104: SWC Hub requires explicit ack.
    (!swcHub || swcAck) &&
    // bufalina-60733: flagged (medium/high fake-detection) requires explicit ack.
    (!isFlagged || fakeAck) &&
    !submitting &&
    !candidatesLoading;

  const selectedCandidate = partyMeta?.hostCandidates.find((c) => c.userId === recipientUserId) ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selectedCandidate) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Step 1: create a pending payout via the host-side endpoint with the
      // admin `recipientHostUserId` override so the row is credited to the
      // chosen cohost, not the admin clicking Send.
      //
      // soppressata-49320: only create on the FIRST attempt. If a prior submit
      // got past create but failed at approve/execute, `createdPayoutIdRef`
      // already holds the pending row's id — reuse it instead of creating a
      // second orphan. The invalidation effect above clears the ref whenever
      // the defining inputs change, so a reused id always matches the form.
      if (!createdPayoutIdRef.current) {
        const created = await createPayout(partyId, {
          pizzaPhotos: [],
          eventPhotos: [],
          receiptPhotos: [],
          payoutMethod: method,
          payoutWalletAddress:
            method === 'usdc_base' ? walletAddress.trim() : undefined,
          payoutBankDetails:
            method === 'wire' && bankEmail.trim()
              ? { email: bankEmail.trim() }
              : undefined,
          mercuryCardLast4:
            method === 'mercury_card' ? mercuryCardLast4.trim() : undefined,
          finalAmountUsd: amountNum,
          recipientHostUserId: selectedCandidate.userId,
          adminNotes:
            note.trim() ||
            `Send payment via ${method} from admin /payments by-city action`,
          hostNotes: 'Payment sent by admin (salame-92106)',
        });
        createdPayoutIdRef.current = created.id;
      }
      const payoutId = createdPayoutIdRef.current;

      // Step 2 + 3: approve, and for USDC autoExecute via Privy server-wallet.
      // For wire / mercury, the approve call won't execute — we follow up
      // with a separate POST /execute carrying the refs (and any cap-override
      // ack).
      //
      // nduja-92106: the per-party cap ack now also flows into /approve (both
      // direct and autoExecute branches) — previously the override only worked
      // on /execute, so the USDC path here would 409 at approve time even
      // with the ack ticked. Forward `allowOverPartyCap` on every approve
      // call so the bocconcini-49102 recheck is skipped consistently.
      const allowOverPartyCap = partyWouldExceedCap ? overridePartyCap : undefined;
      // guanciale-49340: forward the per-address ($676) cap ack to BOTH the
      // approve (usdc autoExecute) and execute (wire/mercury) branches.
      const allowOverPerAddressCap = walletPaidTotal?.wouldExceed
        ? overridePerAddressCap
        : undefined;
      if (method === 'usdc_base') {
        // guanciale-49340: the approve handler runs executePayout server-side
        // for USDC and keeps the HTTP 200 contract even when the on-chain send
        // FAILS (the row is flipped to `failed`). Previously we ignored the
        // response, so a failed transfer surfaced as a false "Sent" toast.
        // Inspect `autoExecuted` and throw with the skip reason so the catch
        // below shows the error AND skips onSent()/onClose(). The throw happens
        // BEFORE the createdPayoutIdRef reset so a retry re-drives the failed
        // row rather than orphaning a second one.
        const res = await approveAdminPayout(payoutId, {
          autoExecute: true,
          note: note.trim() || undefined,
          allowOverPartyCap,
          allowOverPerAddressCap,
        });
        if (res.autoExecuted !== true) {
          throw new Error(
            res.autoExecuteSkippedReason ||
              'USDC transfer failed — the payout was marked failed and no funds moved.',
          );
        }
      } else {
        await approveAdminPayout(payoutId, {
          note: note.trim() || undefined,
          allowOverPartyCap,
        });
        await executeAdminPayout(payoutId, {
          wireReference:
            method === 'wire' ? wireReference.trim() : undefined,
          mercuryCardLast4:
            method === 'mercury_card' ? mercuryCardLast4.trim() : undefined,
          mercuryCardId:
            method === 'mercury_card' && mercuryCardId.trim()
              ? mercuryCardId.trim()
              : undefined,
          note: note.trim() || undefined,
          // salame-92103: forward the admin's per-party cap ack so the
          // server bypasses its own check + appends `[override: party cap]`
          // to the audit row's note.
          allowOverPartyCap,
          // guanciale-49340: forward the per-address ($676) cap ack so the
          // wire/mercury execute path bypasses the per-address hard cap too.
          allowOverPerAddressCap,
        });
      }

      // soppressata-49320: full success — clear the persisted id so any future
      // submit (e.g. modal reused) creates a fresh row rather than re-driving
      // this now-completed one.
      createdPayoutIdRef.current = null;
      onSent({ partyName: cleanName, method, amountUsd: amountNum });
      onClose();
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to send payment');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-theme-surface rounded-2xl shadow-2xl border border-theme-stroke w-full max-w-[95vw] sm:max-w-2xl max-h-[95vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-theme-stroke">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-theme-text truncate">
              Send payment to {cleanName}
            </h2>
            <p className="text-xs text-theme-text-muted mt-0.5">
              Actively sends from rsv.pizza&apos;s payment infrastructure
              (USDC on Base / wire / Mercury card). Use{' '}
              <em>Add external payment</em> to log an off-platform payment, or{' '}
              <em>Mark city paid</em> to flip in-flight rows to paid.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-theme-surface-hover text-theme-text-muted"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* parmigiana-92104: SWC Hub warning — shared component, gated on
              `swcHub` derived from country + event_tags. */}
          <SwcHubWarning
            isSwcHub={swcHub}
            acked={swcAck}
            onAckChange={setSwcAck}
          />

          {/* Recipient picker */}
          <div>
            <div className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">
              Recipient
            </div>
            {candidatesLoading && (
              <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-theme-text-muted">
                <Loader2 size={14} className="animate-spin" />
                Loading recipients…
              </div>
            )}
            {candidatesError && !candidatesLoading && (
              <div className="px-3 py-2.5 text-xs text-red-400">
                {candidatesError}
              </div>
            )}
            {!candidatesLoading && partyMeta && (
              <div className="space-y-2">
                {partyMeta.hostCandidates.map((c) => {
                  const active = recipientUserId === c.userId;
                  const label = c.name && c.name.trim() ? c.name : (c.email || 'Unnamed');
                  return (
                    <label
                      key={c.userId}
                      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                        active
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-theme-stroke bg-theme-surface hover:border-theme-stroke-strong'
                      }`}
                    >
                      <input
                        type="radio"
                        name="send-recipient"
                        value={c.userId}
                        checked={active}
                        onChange={() => setRecipientUserId(c.userId)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-theme-text">
                          {c.role === 'host' && (
                            <Star size={12} className="text-amber-500 shrink-0" />
                          )}
                          <span className="truncate">{label}</span>
                          {c.role === 'host' && (
                            <span className="text-[10px] uppercase tracking-wide text-amber-500/80 shrink-0">
                              Primary host
                            </span>
                          )}
                        </div>
                        {c.email && (
                          <div className="text-xs text-theme-text-muted truncate">
                            {c.email}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
                {partyMeta.hostCandidates.length === 0 && (
                  <div className="text-xs text-red-400">
                    No payable hosts found for this city.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Amount */}
          <div>
            <IconInput
              icon={DollarSign}
              type="number"
              step="0.01"
              min="0"
              placeholder="Amount USD *"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              required
            />
            <p className="text-xs text-theme-text-muted mt-1">
              {/* gnocchi-92105: pre-fill = receipts - paid (no cap clamp).
                  Outstanding is shown for context but isn't the default any
                  more — Snax wanted the raw subtraction so admins can spot
                  receipts that haven't been paid out yet. */}
              Defaults to receipts − paid ($
              {Math.max(0, receiptsTotalUsd - paidTotalUsd).toFixed(2)}).
              Outstanding (Approved − Paid) for this city is $
              {outstandingUsd.toFixed(2)}.
            </p>
            {exceedsPerSubmission && (
              <p className="text-xs text-red-500 mt-1">
                Single payments capped at ${perSubmissionMaxUsd}.
              </p>
            )}
          </div>

          {/* Method radios */}
          <div>
            <div className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">
              Method
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <MethodOption
                value="usdc_base"
                current={method}
                onSelect={setMethod}
                icon={<Coins size={16} />}
                label="USDC on Base"
              />
              <MethodOption
                value="mercury_card"
                current={method}
                onSelect={setMethod}
                icon={<CreditCard size={16} />}
                label="Mercury card"
                disabled={mercuryBlocked}
                disabledReason={
                  mercuryBlocked
                    ? `Mercury unavailable in ${country ?? 'this country'}`
                    : null
                }
              />
              <MethodOption
                value="wire"
                current={method}
                onSelect={setMethod}
                icon={<Banknote size={16} />}
                label="Wire"
              />
            </div>
          </div>

          {/* Per-method destination input */}
          {method === 'usdc_base' && (
            <div>
              <IconInput
                icon={Wallet}
                placeholder="USDC wallet address or ENS (e.g. 0x… or alice.eth) *"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                required
              />
              <p className="text-xs text-theme-text-muted mt-1">
                ENS names are resolved server-side before the on-chain send.
              </p>
            </div>
          )}
          {method === 'wire' && (
            <>
              <IconInput
                icon={Mail}
                type="email"
                placeholder="Recipient bank-correspondence email (optional)"
                value={bankEmail}
                onChange={(e) => setBankEmail(e.target.value)}
              />
              <IconInput
                icon={Hash}
                placeholder="Wire reference number *"
                value={wireReference}
                onChange={(e) => setWireReference(e.target.value)}
              />
            </>
          )}
          {method === 'mercury_card' && (
            <>
              <IconInput
                icon={Hash}
                placeholder="Card last 4 digits (required, exactly 4 numbers)"
                value={mercuryCardLast4}
                onChange={(e) =>
                  setMercuryCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))
                }
                inputMode="numeric"
                maxLength={4}
              />
              <IconInput
                icon={Hash}
                placeholder="Mercury card id (optional)"
                value={mercuryCardId}
                onChange={(e) => setMercuryCardId(e.target.value)}
              />
            </>
          )}

          {/* salame-92103: per-party cap warning + ack. */}
          {partyWouldExceedCap && effectiveReimbursementCapUsd != null && (
            <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/10">
              <div className="flex items-start gap-2.5">
                <AlertTriangle
                  className="text-amber-300 [.gpp-theme_&]:text-amber-700 mt-0.5 flex-shrink-0"
                  size={16}
                />
                <div className="flex-1 text-sm">
                  <div className="font-medium text-amber-200 [.gpp-theme_&]:text-amber-900 mb-1">
                    Per-party cap warning
                  </div>
                  <div className="text-theme-text-secondary [.gpp-theme_&]:text-amber-900 text-xs">
                    This send exceeds the party&apos;s ${effectiveReimbursementCapUsd.toFixed(2)} cap by{' '}
                    <b>${partyOverBy.toFixed(2)}</b>{' '}
                    (remaining: ${(capRemaining ?? 0).toFixed(2)}).
                  </div>
                  <div className="mt-3">
                    <Checkbox
                      checked={overridePartyCap}
                      onChange={() => setOverridePartyCap((v) => !v)}
                      label="I acknowledge — proceed anyway"
                      labelClassName="text-sm text-amber-100 [.gpp-theme_&]:text-amber-900"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* guanciale-49340: per-address $676 cap warning + ack (bianco-89172
              pattern from PayoutReviewModal). Only the usdc_base path resolves
              a 0x destination wallet, so the warning is USDC-only. Surfaces
              when the recipient wallet's cumulative paid total + this send
              would push past the per-address cap; Send is gated until acked. */}
          {method === 'usdc_base' && walletPaidLoading && (
            <div className="text-xs text-theme-text-muted inline-flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" /> Checking per-address total…
            </div>
          )}
          {method === 'usdc_base' &&
            !walletPaidLoading &&
            walletPaidTotal?.wouldExceed && (
              <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/10">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle
                    className="text-amber-300 [.gpp-theme_&]:text-amber-700 mt-0.5 flex-shrink-0"
                    size={16}
                  />
                  <div className="flex-1 text-sm">
                    <div className="font-medium text-amber-200 [.gpp-theme_&]:text-amber-900 mb-1">
                      Per-address cap warning
                    </div>
                    <div className="text-theme-text-secondary [.gpp-theme_&]:text-amber-900 text-xs">
                      Wallet{' '}
                      <code className="font-mono text-[11px]">
                        {walletAddress.trim().slice(0, 6)}…{walletAddress.trim().slice(-4)}
                      </code>{' '}
                      has already received{' '}
                      <b>${walletPaidTotal.paidUsd.toFixed(2)}</b>{' '}
                      across {walletPaidTotal.paidCount} payout
                      {walletPaidTotal.paidCount === 1 ? '' : 's'}. Sending{' '}
                      <b>${amountNum.toFixed(2)}</b> would push the total to{' '}
                      <b>${(walletPaidTotal.paidUsd + amountNum).toFixed(2)}</b>
                      , exceeding the ${walletPaidTotal.capUsd} per-address cap.
                    </div>
                    <div className="mt-3">
                      <Checkbox
                        checked={overridePerAddressCap}
                        onChange={() => setOverridePerAddressCap((v) => !v)}
                        label="I acknowledge — proceed anyway"
                        labelClassName="text-sm text-amber-100 [.gpp-theme_&]:text-amber-900"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

          {/* bufalina-60733: fake-detection risk warning + ack. Shows when
              this party scored medium/high; gates Send behind an explicit
              acknowledgement (mirrors the cap-override ack card above). */}
          {isFlagged && (
            <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/10">
              <div className="flex items-start gap-2.5">
                <AlertTriangle
                  className="text-amber-300 [.gpp-theme_&]:text-amber-700 mt-0.5 flex-shrink-0"
                  size={16}
                />
                <div className="flex-1 text-sm">
                  <div className="font-medium text-amber-200 [.gpp-theme_&]:text-amber-900 mb-1">
                    Fake-detection risk on {cleanName}
                  </div>
                  <div className="text-theme-text-secondary [.gpp-theme_&]:text-amber-900 text-xs">
                    This event scored{' '}
                    <b>
                      Risk {fakeScore ?? 0} ({fakeTier})
                    </b>{' '}
                    in fake-event detection. Review its flags before sending.
                  </div>
                  {fakeTopFlags && fakeTopFlags.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-theme-text-secondary [.gpp-theme_&]:text-amber-900 list-disc list-inside">
                      {fakeTopFlags.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3">
                    <Checkbox
                      checked={fakeAck}
                      onChange={() => setFakeAck((v) => !v)}
                      label="I've reviewed this event's fake-detection flags"
                      labelClassName="text-sm text-amber-100 [.gpp-theme_&]:text-amber-900"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Internal note */}
          <IconInput
            icon={Pencil}
            multiline
            rows={3}
            placeholder="Internal note (optional, written to the audit log)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
          />

          {submitError && (
            <div className="px-3 py-2 rounded-lg bg-red-100 text-red-700 border border-red-300 text-sm">
              {submitError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-theme-stroke px-5 py-3 flex items-center justify-end gap-2 bg-theme-surface">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Send payment
          </button>
        </div>
      </form>
    </div>
  );
};

const MethodOption: React.FC<{
  value: Method;
  current: Method;
  onSelect: (v: Method) => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  disabledReason?: string | null;
}> = ({ value, current, onSelect, icon, label, disabled, disabledReason }) => {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => !disabled && onSelect(value)}
      disabled={disabled}
      title={disabled && disabledReason ? disabledReason : undefined}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
        disabled
          ? 'border-theme-stroke bg-theme-surface text-theme-text-muted opacity-60 cursor-not-allowed'
          : active
            ? 'border-emerald-500 bg-emerald-500/10 text-theme-text'
            : 'border-theme-stroke bg-theme-surface hover:border-theme-stroke-strong text-theme-text-secondary'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
};
