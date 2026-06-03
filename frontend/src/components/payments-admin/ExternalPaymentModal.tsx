import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  DollarSign,
  Mail,
  Calendar,
  Link as LinkIcon,
  Pencil,
  Hash,
  Upload,
  Loader2,
  CreditCard,
  Coins,
  Banknote,
  HelpCircle,
  Search,
  Check,
  AlertTriangle,
  Star,
} from 'lucide-react';
import { IconInput } from '../IconInput';
import { SwcHubWarning } from './SwcHubWarning';
import { isSwcHubParty } from '../../utils/swcHub';
import {
  recordExternalPayment,
  searchApprovedParties,
  type ApprovedPartySearchResult,
} from '../../lib/api';
import { uploadPayoutPhoto } from '../../lib/supabase';
import type { ExternalPaymentInput, PayoutMethod } from '../../types';

/**
 * lasagna-92103: $675 is the "sane-default" per-submission soft cap. The
 * backend admin POST /external no longer enforces it (admin amount is
 * canonical), so this constant now drives a purely informational amber
 * warning — no Checkbox, no Submit block. The USDC execute hard ceiling
 * is irrelevant for external (off-platform) payments which are already
 * settled outside our hot wallet.
 */
const PER_SUBMISSION_MAX_USD = 675;

interface ExternalPaymentModalProps {
  onClose: () => void;
  onCreated: () => void;
  /**
   * mostarda-92103: optional pre-filled search query so opening this modal
   * from a specific city row in the by-city table seeds the party picker
   * with the city name. Admin still has to confirm the pick from the
   * dropdown so we don't silently stamp the wrong party.
   */
  initialQuery?: string;
}

type ExternalMethod = PayoutMethod | 'other';

/**
 * Admin modal for recording payments that happened OUTSIDE the rsv.pizza
 * payouts flow (Venmo, manual bank transfer, etc.). Creates a new payout row
 * in `paid` status immediately so the host's "paid so far" total reflects it
 * and there's an audit trail.
 *
 * arugula-38633 v2 follow-up — replaces the bare partyId / hostUserId text
 * inputs with:
 *   - Party: search-as-you-type over approved parties.
 *   - Host: dropdown of the selected party's main host + resolvable cohosts.
 *     Cohosts whose email is not in the User table are excluded server-side.
 */
export const ExternalPaymentModal: React.FC<ExternalPaymentModalProps> = ({
  onClose,
  onCreated,
  initialQuery,
}) => {
  // Party picker state — `selectedParty` is the source of truth for partyId +
  // the list of host candidates. `recipientUserId` is the chosen userId within
  // that list (defaults to the main host on selection when only one candidate).
  // mortazza-92103: an admin can also pick "other" and type an arbitrary email,
  // which the backend resolves to a User at submit time.
  const [selectedParty, setSelectedParty] = useState<ApprovedPartySearchResult | null>(null);
  // '' = no selection, 'other' = free-form email path, otherwise a userId from
  // selectedParty.hostCandidates.
  const [recipientUserId, setRecipientUserId] = useState<string>('');
  const [recipientEmailInput, setRecipientEmailInput] = useState('');

  // mostarda-92103: seed the party picker with the caller-provided query so
  // the by-city "Add external payment" action lands on a populated search
  // result list instead of an empty picker.
  const [partyQuery, setPartyQuery] = useState(initialQuery ?? '');
  const [partyResults, setPartyResults] = useState<ApprovedPartySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Other form state — unchanged from v1.
  const [amountStr, setAmountStr] = useState('');
  const [method, setMethod] = useState<ExternalMethod>('usdc_base');
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().split('T')[0]);

  // Method-specific refs
  const [wireReference, setWireReference] = useState('');
  const [transactionHash, setTransactionHash] = useState('');
  const [mercuryCardLast4, setMercuryCardLast4] = useState('');

  // Proof: either a URL or an uploaded file. The uploaded URL wins if both set.
  const [proofUrlInput, setProofUrlInput] = useState('');
  const [uploadedProofUrl, setUploadedProofUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [adminNotes, setAdminNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // lasagna-92103: removed `ackOverSubmissionCap` — backend POST /external no
  // longer enforces the per-submission cap. Admin amount is canonical; the
  // amber warning below is informational only.

  // parmigiana-92104: SWC Hub ack. Surfaced after a party is selected if it
  // matches the SWC Hub heuristic (country='United States' OR event_tags
  // includes 'SWC Hub'). Confirm button stays disabled until acked. Reset
  // when the admin picks a different party so the ack doesn't carry across
  // selections.
  const [swcAck, setSwcAck] = useState(false);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Debounced party search — only runs when the picker is "open" (no party
  // selected yet) and the query has ≥2 chars.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (selectedParty) {
      // Picker is collapsed; no need to search.
      setPartyResults([]);
      setSearching(false);
      return;
    }
    const q = partyQuery.trim();
    if (q.length < 2) {
      setPartyResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError(null);
    debounceRef.current = setTimeout(async () => {
      try {
        const rows = await searchApprovedParties(q);
        setPartyResults(rows);
      } catch (e: any) {
        setSearchError(e?.message || 'Search failed');
        setPartyResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [partyQuery, selectedParty]);

  const amountNum = useMemo(() => Number(amountStr), [amountStr]);

  // lasagna-92103: typed amount exceeds the $675 soft cap. Drives the
  // informational amber warning below — no longer blocks Submit.
  const exceedsCap =
    Number.isFinite(amountNum) && amountNum > PER_SUBMISSION_MAX_USD;

  // derived: the active partyId (only set once a party is picked).
  const partyId = selectedParty?.id ?? '';

  // mortazza-92103: a candidate is "valid" for submission when the admin has
  // either picked a known candidate (recipientUserId is a userId from the list)
  // or picked "other" AND typed a non-empty email.
  const recipientReady = useMemo(() => {
    if (!recipientUserId) return false;
    if (recipientUserId === 'other') {
      // Cheap client-side shape check; backend does the real validation.
      const e = recipientEmailInput.trim();
      return e.length > 0 && /.+@.+\..+/.test(e);
    }
    return true;
  }, [recipientUserId, recipientEmailInput]);

  // parmigiana-92104: derive SWC Hub status from the selected party (clean
  // when nothing's selected yet).
  const swcHub = isSwcHubParty(selectedParty);

  const canSubmit = useMemo(() => {
    if (!partyId.trim()) return false;
    if (!recipientReady) return false;
    if (!Number.isFinite(amountNum) || amountNum <= 0) return false;
    if (!adminNotes.trim()) return false;
    // lasagna-92103: over-cap submissions are no longer gated on an ack —
    // admin amount is canonical; the warning is informational only.
    // parmigiana-92104: SWC Hub parties require an ack before submit. The
    // backend POST /external stays open so admins can still record the
    // payment once they confirm.
    if (swcHub && !swcAck) return false;
    return !submitting && !uploading;
  }, [
    partyId,
    recipientReady,
    amountNum,
    adminNotes,
    submitting,
    uploading,
    swcHub,
    swcAck,
  ]);

  function handlePickParty(p: ApprovedPartySearchResult) {
    setSelectedParty(p);
    // mortazza-92103: only auto-select when there's a single non-staff
    // candidate so admins MUST consciously pick when multiple cohosts exist.
    // (Bug example: Snax recorded $1000 for Paris meant for Louis but
    // host_user_id stamped as Snax — the auto-default-to-main-host was wrong
    // when the actual recipient was a cohost.)
    if (p.hostCandidates.length === 1) {
      setRecipientUserId(p.hostCandidates[0].userId);
    } else {
      setRecipientUserId('');
    }
    setRecipientEmailInput('');
    setPartyQuery('');
    setPartyResults([]);
    setSearchError(null);
    // parmigiana-92104: reset SWC Hub ack on every party switch so the prior
    // ack doesn't bleed into the new selection.
    setSwcAck(false);
  }

  function handleChangeParty() {
    setSelectedParty(null);
    setRecipientUserId('');
    setRecipientEmailInput('');
    setPartyQuery('');
    setPartyResults([]);
    // parmigiana-92104: also clear the SWC Hub ack when the admin unpicks.
    setSwcAck(false);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!partyId.trim()) {
      setUploadError('Pick a party first so we can group the upload correctly.');
      e.target.value = '';
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      // Group under an `external/<timestamp>` pseudo-tempId so the path shape
      // still matches `payouts/{partyId}/{group}/{kind}/...`.
      const groupId = `external-${Date.now()}`;
      const result = await uploadPayoutPhoto(file, partyId.trim(), groupId, 'receipt');
      setUploadedProofUrl(result.url);
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Uploaded file wins over the manually-typed URL (the plan says either,
      // but if both are present the uploaded one is the canonical proof).
      const externalProofUrl = uploadedProofUrl?.trim()
        || (proofUrlInput.trim() || undefined);

      // The free-form notes get "Other: <method>" prefixed when method='other'
      // so the audit trail captures the real intent (DB CHECK only allows the 3).
      const composedAdminNotes = method === 'other'
        ? `Other method. ${adminNotes.trim()}`
        : adminNotes.trim();

      // mortazza-92103: route the recipient through the override field so the
      // backend stamps `host_user_id` correctly. When the admin picked "Other",
      // forward `recipientEmail` and let the backend resolve it (rejects with
      // 400 RECIPIENT_USER_NOT_FOUND if the email doesn't map to a User).
      const body: ExternalPaymentInput = {
        partyId: partyId.trim(),
        finalAmountUsd: amountNum,
        payoutMethod: method,
        paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
        externalProofUrl,
        adminNotes: composedAdminNotes,
      };
      if (recipientUserId === 'other') {
        body.recipientEmail = recipientEmailInput.trim();
      } else {
        body.recipientHostUserId = recipientUserId;
      }
      // lasagna-92103: no longer forward `allowOverSubmissionCap` — the
      // backend POST /external ignores it. Admin amount is canonical.
      if (method === 'wire' || method === 'other') {
        if (wireReference.trim()) body.wireReference = wireReference.trim();
      }
      if (method === 'usdc_base' && transactionHash.trim()) {
        body.transactionHash = transactionHash.trim();
      }
      if (method === 'mercury_card' && mercuryCardLast4.trim()) {
        body.mercuryCardLast4 = mercuryCardLast4.trim();
      }

      await recordExternalPayment(body);
      onCreated();
      onClose();
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to record payment');
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
            <h2 className="text-lg font-semibold text-theme-text">Record External Payment</h2>
            <p className="text-xs text-theme-text-muted mt-0.5">
              Use this for payments made OUTSIDE rsv.pizza (Venmo, manual bank, etc.). Creates a paid
              payment row immediately and writes an audit entry.
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
          {/* Party picker — search-as-you-type, or selected card */}
          <div>
            {selectedParty ? (
              <div className="flex items-start gap-3 px-3 py-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5">
                <Check size={16} className="mt-0.5 text-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-theme-text truncate">
                    {selectedParty.name}
                  </div>
                  <div className="text-xs text-theme-text-muted mt-0.5">
                    Invite code: {selectedParty.inviteCode}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleChangeParty}
                  className="text-xs text-theme-text-muted hover:text-theme-text underline shrink-0"
                >
                  change
                </button>
              </div>
            ) : (
              <div className="relative">
                <IconInput
                  icon={Search}
                  placeholder="Search approved parties by name *"
                  value={partyQuery}
                  onChange={(e) => setPartyQuery(e.target.value)}
                  autoComplete="off"
                />
                {/* Dropdown — only render when the input is "active" (has any
                    text, or focus would have produced results). We key off
                    `partyQuery.length > 0` to avoid an empty floating panel. */}
                {partyQuery.trim().length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-theme-surface border border-theme-stroke rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {searching && (
                      <div className="flex items-center gap-2 px-3 py-3 text-xs text-theme-text-muted">
                        <Loader2 size={14} className="animate-spin" />
                        Searching…
                      </div>
                    )}
                    {!searching && partyQuery.trim().length < 2 && (
                      <div className="px-3 py-3 text-xs text-theme-text-muted">
                        Type at least 2 characters to search.
                      </div>
                    )}
                    {!searching && partyQuery.trim().length >= 2 && partyResults.length === 0 && !searchError && (
                      <div className="px-3 py-3 text-xs text-theme-text-muted">
                        No matching approved parties.
                      </div>
                    )}
                    {searchError && (
                      <div className="px-3 py-3 text-xs text-red-400">{searchError}</div>
                    )}
                    {partyResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handlePickParty(p)}
                        className="w-full text-left px-3 py-2 hover:bg-theme-surface-hover border-b border-theme-stroke last:border-b-0"
                      >
                        <div className="text-sm text-theme-text truncate">{p.name}</div>
                        <div className="text-xs text-theme-text-muted mt-0.5">{p.inviteCode}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!selectedParty && (
              <p className="text-xs text-theme-text-muted mt-1">
                Only approved events are searchable. Pick one to populate the party + host fields.
              </p>
            )}
          </div>

          {/* parmigiana-92104: SWC Hub reimbursement warning. Surfaces once a
              party is picked AND that party matches the SWC Hub heuristic
              (country='United States' OR event_tags includes 'SWC Hub').
              Confirm button stays disabled until the admin ticks the ack. */}
          {selectedParty && (
            <SwcHubWarning
              isSwcHub={swcHub}
              acked={swcAck}
              onAckChange={setSwcAck}
            />
          )}

          {/* Recipient picker — only shown once a party is selected.
              mortazza-92103: radio list (ports the bismarck-92103 prepay UX)
              so admins explicitly pick the actual recipient cohost instead of
              defaulting to themselves. "Other (specify)" handles edge cases
              where the recipient isn't in the party's candidate list yet. */}
          {selectedParty && (
            <div>
              <div className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">
                Recipient
              </div>
              <div className="space-y-2">
                {selectedParty.hostCandidates.map((c) => {
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
                        name="recipient"
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

                {/* "Other (specify)" — free-form email fallback. Backend
                    resolves the email to a User at submit time and rejects
                    with RECIPIENT_USER_NOT_FOUND if no match. */}
                <label
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    recipientUserId === 'other'
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-theme-stroke bg-theme-surface hover:border-theme-stroke-strong'
                  }`}
                >
                  <input
                    type="radio"
                    name="recipient"
                    value="other"
                    checked={recipientUserId === 'other'}
                    onChange={() => setRecipientUserId('other')}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-theme-text">
                      Other (specify by email)
                    </div>
                    <div className="text-xs text-theme-text-muted mt-0.5">
                      Use when the recipient isn't in the candidate list. Email
                      must already match an rsv.pizza User account.
                    </div>
                    {recipientUserId === 'other' && (
                      <div className="mt-2">
                        <IconInput
                          icon={Mail}
                          type="email"
                          placeholder="recipient@example.com *"
                          value={recipientEmailInput}
                          onChange={(e) => setRecipientEmailInput(e.target.value)}
                          autoComplete="off"
                        />
                      </div>
                    )}
                  </div>
                </label>
              </div>
              <p className="text-xs text-theme-text-muted mt-2">
                Main host plus cohosts whose email matches a User account. Pick
                the actual recipient — the audit row will credit them, not you.
              </p>
            </div>
          )}

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
            {/* lasagna-92103: informational amber heads-up when the typed
                amount exceeds the $675 sane-default cap. NOT a gate — admin
                amount is canonical for external records. External payments
                don't go through our hot wallet so the per-tx ceiling is
                irrelevant; this is purely a visual nudge so admins notice
                unusually large amounts before submitting. */}
            {exceedsCap && (
              <div className="card p-4 border-l-4 border-l-amber-500 bg-amber-500/10 mt-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="text-amber-300 mt-0.5 flex-shrink-0" size={18} />
                  <div className="flex-1 text-sm">
                    <div className="font-medium text-amber-200 mb-1">
                      Heads-up: over per-submission soft cap
                    </div>
                    <div className="text-theme-text-secondary">
                      ${amountNum.toFixed(2)} is over the ${PER_SUBMISSION_MAX_USD} per-submission
                      soft cap. Admin edits aren&apos;t gated by this — proceed if intentional.
                      External payments don&apos;t go through our hot wallet so the USDC per-tx
                      ceiling doesn&apos;t apply here.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Method radios — USDC / Mercury / Wire / Other, matching reorder pref */}
          <div>
            <div className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">Method</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
              />
              <MethodOption
                value="wire"
                current={method}
                onSelect={setMethod}
                icon={<Banknote size={16} />}
                label="Wire"
              />
              <MethodOption
                value="other"
                current={method}
                onSelect={setMethod}
                icon={<HelpCircle size={16} />}
                label="Other"
              />
            </div>
            {method === 'other' && (
              <p className="text-xs text-theme-text-muted mt-2">
                "Other" stores as <code>wire</code> in the DB (CHECK constraint), but the real method
                will be captured in admin notes as <code>Other method.</code>
              </p>
            )}
          </div>

          {/* Method-specific reference */}
          {method === 'usdc_base' && (
            <IconInput
              icon={Hash}
              placeholder="Transaction hash (optional, 0x...)"
              value={transactionHash}
              onChange={(e) => setTransactionHash(e.target.value)}
            />
          )}
          {method === 'mercury_card' && (
            <IconInput
              icon={Hash}
              placeholder="Card last 4 digits (optional)"
              value={mercuryCardLast4}
              onChange={(e) =>
                setMercuryCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))
              }
              inputMode="numeric"
              maxLength={4}
            />
          )}
          {(method === 'wire' || method === 'other') && (
            <IconInput
              icon={Hash}
              placeholder={
                method === 'other'
                  ? 'Reference (optional — e.g. Venmo transaction id)'
                  : 'Wire reference (optional)'
              }
              value={wireReference}
              onChange={(e) => setWireReference(e.target.value)}
            />
          )}

          {/* Date paid */}
          <IconInput
            icon={Calendar}
            type="date"
            placeholder="Date paid"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
          />

          {/* Proof — URL or upload */}
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-theme-text-muted">
              Proof (optional)
            </div>
            <IconInput
              icon={LinkIcon}
              type="url"
              placeholder="Transaction URL (e.g. Basescan, Venmo receipt link)"
              value={proofUrlInput}
              onChange={(e) => setProofUrlInput(e.target.value)}
              disabled={!!uploadedProofUrl}
            />
            <div className="text-xs text-theme-text-muted">— or —</div>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-theme-surface-hover hover:bg-theme-stroke text-sm text-theme-text cursor-pointer w-fit">
              {uploading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              {uploadedProofUrl ? 'Replace proof file' : 'Upload proof file'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
                disabled={uploading}
              />
            </label>
            {uploadError && (
              <p className="text-xs text-red-400">{uploadError}</p>
            )}
            {uploadedProofUrl && (
              <p className="text-xs text-emerald-500 break-all">
                Uploaded:{' '}
                <a
                  href={uploadedProofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {uploadedProofUrl}
                </a>
                {' '}
                <button
                  type="button"
                  className="ml-1 underline text-theme-text-muted"
                  onClick={() => setUploadedProofUrl(null)}
                >
                  clear
                </button>
              </p>
            )}
          </div>

          {/* Admin notes — required */}
          <div>
            <IconInput
              icon={Pencil}
              multiline
              rows={3}
              placeholder="Why is this being recorded? What was paid for? *"
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              required
              maxLength={500}
            />
            <p className="text-xs text-theme-text-muted mt-1">
              Required. The backend prefixes "External payment recorded." automatically.
            </p>
          </div>

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
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Record payment
          </button>
        </div>
      </form>
    </div>
  );
};

const MethodOption: React.FC<{
  value: ExternalMethod;
  current: ExternalMethod;
  onSelect: (v: ExternalMethod) => void;
  icon: React.ReactNode;
  label: string;
}> = ({ value, current, onSelect, icon, label }) => {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
        active
          ? 'border-emerald-500 bg-emerald-500/10 text-theme-text'
          : 'border-theme-stroke bg-theme-surface hover:border-theme-stroke-strong text-theme-text-secondary'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
};
