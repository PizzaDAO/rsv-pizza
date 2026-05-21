import React, { useEffect, useState } from 'react';
import { X, Check, AlertTriangle, ExternalLink, Loader2, Pencil, Send, DollarSign, RefreshCw } from 'lucide-react';
import { IconInput } from '../IconInput';
import { ClickableEmail } from '../ClickableEmail';
import type { AdminPayoutDetail, PayoutAuditEntry } from '../../types';
import {
  PayoutStatusPill,
  PayoutMethodIcon,
  PAYOUT_METHOD_LABELS,
  formatUsd,
  formatOriginalCurrency,
} from '../payments-shared';

interface PayoutReviewModalProps {
  payout: AdminPayoutDetail;
  /** When set, indicates the actor would be paying themselves — disables mutate buttons. */
  selfPayoutBlocked?: boolean;
  onClose: () => void;
  onApprove: (note?: string) => Promise<void> | void;
  onReject: (reason: string) => Promise<void> | void;
  onSaveAmount: (newAmount: number, note?: string) => Promise<void> | void;
  onSaveAdminNotes: (notes: string) => Promise<void> | void;
  onMarkPaid: (refs: {
    wireReference?: string;
    transactionHash?: string;
    mercuryCardLast4?: string;
    mercuryCardId?: string;
    note?: string;
  }) => Promise<void> | void;
  /**
   * Execute payout (PR 5). For USDC → no body, server sends via Privy.
   * For wire / mercury_card → admin-supplied refs.
   */
  onExecute: (body: {
    wireReference?: string;
    mercuryCardLast4?: string;
    mercuryCardId?: string;
    note?: string;
  }) => Promise<void> | void;
  /**
   * Optional fetcher for the USDC daily-cap-remaining hint. Only called when
   * the admin opens the USDC execute confirmation. Returns null if unavailable.
   */
  fetchUsdcCapRemaining?: () => Promise<{ usedUsd: number; capUsd: number; remainingUsd: number } | null>;
  /** Re-open (clear rejected/failed) — uses mark-paid plumbing or a future endpoint. */
  onReopen?: () => Promise<void> | void;
  busy?: boolean;
}

export const PayoutReviewModal: React.FC<PayoutReviewModalProps> = ({
  payout,
  selfPayoutBlocked,
  onClose,
  onApprove,
  onReject,
  onSaveAmount,
  onSaveAdminNotes,
  onMarkPaid,
  onExecute,
  fetchUsdcCapRemaining,
  onReopen,
  busy = false,
}) => {
  const [editingAmount, setEditingAmount] = useState(false);
  const [draftAmount, setDraftAmount] = useState(String(payout.finalAmountUsd));
  const [adminNotes, setAdminNotes] = useState(payout.adminNotes ?? '');
  const [adminNotesDirty, setAdminNotesDirty] = useState(false);

  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const [showMarkPaidForm, setShowMarkPaidForm] = useState(false);
  const [wireRef, setWireRef] = useState('');
  const [txHash, setTxHash] = useState('');
  const [cardLast4, setCardLast4] = useState('');
  const [cardId, setCardId] = useState('');
  const [paidNote, setPaidNote] = useState('');

  // Execute-payout (PR 5) — method-specific confirmation form
  const [showExecuteForm, setShowExecuteForm] = useState(false);
  const [execWireRef, setExecWireRef] = useState('');
  const [execCardLast4, setExecCardLast4] = useState('');
  const [execCardId, setExecCardId] = useState('');
  const [execNote, setExecNote] = useState('');
  const [usdcCap, setUsdcCap] = useState<
    { usedUsd: number; capUsd: number; remainingUsd: number } | null
  >(null);
  const [usdcCapLoading, setUsdcCapLoading] = useState(false);

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (lightboxUrl) setLightboxUrl(null);
        else onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, lightboxUrl]);

  const receipts = payout.documents.filter((d) => d.kind === 'receipt');
  const pizzas = payout.documents.filter((d) => d.kind === 'pizza');
  const allPhotos = [...pizzas, ...receipts];

  const ocrSum = receipts.reduce((sum, r) => sum + (Number(r.ocrAmount) || 0), 0);

  const isPending = payout.status === 'pending';
  const isFailed = payout.status === 'failed';
  // passata-49102: failed payouts are now re-executable, so treat them like
  // 'approved' for the Execute affordance (button + form).
  const isApproved = payout.status === 'approved' || isFailed;
  const isPaid = payout.status === 'paid';
  // 'failed' is no longer "closed" — it has the Execute (Retry) button instead
  // of Re-open. Only 'rejected' remains terminal-until-reopened.
  const isClosed = payout.status === 'rejected';

  // For Mercury, last4 must be exactly 4 digits before the button enables.
  const execMercuryValid = /^\d{4}$/.test(execCardLast4.trim());
  const execWireValid = execWireRef.trim().length > 0;

  async function openExecuteForm() {
    setShowExecuteForm(true);
    setExecWireRef('');
    setExecCardLast4('');
    setExecCardId('');
    setExecNote('');
    if (payout.payoutMethod === 'usdc_base' && fetchUsdcCapRemaining) {
      setUsdcCapLoading(true);
      try {
        const cap = await fetchUsdcCapRemaining();
        setUsdcCap(cap);
      } catch {
        setUsdcCap(null);
      } finally {
        setUsdcCapLoading(false);
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-theme-surface rounded-2xl shadow-2xl border border-theme-stroke w-full max-w-6xl max-h-[95vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-theme-stroke">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-theme-text">
                Payment {payout.id.slice(0, 8)}
              </h2>
              <PayoutStatusPill status={payout.status} size="md" />
              <PayoutMethodIcon method={payout.payoutMethod} showLabel />
            </div>
            <div className="text-xs text-theme-text-muted mt-0.5">
              {payout.host.name || '—'} ·{' '}
              {payout.host.email ? <ClickableEmail email={payout.host.email} /> : '—'} ·{' '}
              <a
                href={`/host/${payout.party.inviteCode}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {payout.party.name}
              </a>
            </div>
            {/* arugula-38633 v2 follow-up: planning vs actuals, prominent.
                arugula-38633 (cap-everywhere): cap appended when set. */}
            <div
              className="text-xs text-theme-text-secondary mt-1"
              title="Expected guests is the host's planning number. Confirmed RSVPs are direct submissions only (excludes bulk invites)."
            >
              <span className="font-medium">Expected guests:</span>{' '}
              {payout.party.expectedGuests != null ? payout.party.expectedGuests : '—'}
              {' · '}
              <span className="font-medium">Confirmed RSVPs:</span>{' '}
              {payout.party.rsvpCount}
              {payout.party.effectiveReimbursementCapUsd != null && (
                <>
                  {' · '}
                  <span className="font-medium">Cap:</span>{' '}
                  ${Number(payout.party.effectiveReimbursementCapUsd).toLocaleString()}
                </>
              )}
            </div>
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

        {selfPayoutBlocked && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-300 text-sm text-amber-800 flex items-center gap-2">
            <AlertTriangle size={14} />
            You are the host on this payment. Payment admins cannot approve/edit their own payments.
          </div>
        )}

        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4 p-5">
          {/* Left: photo gallery */}
          <section>
            <h3 className="text-sm font-semibold text-theme-text mb-2">
              Photos ({allPhotos.length})
            </h3>
            {allPhotos.length === 0 && (
              <p className="text-sm text-theme-text-faint">No photos attached.</p>
            )}
            <div className="grid grid-cols-3 gap-2">
              {allPhotos.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => setLightboxUrl(doc.url)}
                  className="relative aspect-square rounded-lg overflow-hidden border border-theme-stroke group"
                  title={doc.fileName}
                >
                  <img src={doc.url} alt={doc.fileName} className="w-full h-full object-cover" loading="lazy" />
                  <span
                    className={`absolute top-1 left-1 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                      doc.kind === 'receipt' ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'
                    }`}
                  >
                    {doc.kind}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Right: details */}
          <section className="space-y-4">
            {/* Amount */}
            <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-theme-text">Amount</h3>
                {!isPaid && !editingAmount && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftAmount(String(payout.finalAmountUsd));
                      setEditingAmount(true);
                    }}
                    disabled={selfPayoutBlocked || busy}
                    className="inline-flex items-center gap-1 text-xs text-theme-text-secondary hover:text-theme-text disabled:opacity-50"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                )}
              </div>
              {editingAmount ? (
                <div className="flex items-center gap-2">
                  <IconInput
                    icon={DollarSign}
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Final USD amount"
                    value={draftAmount}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraftAmount(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const n = Number(draftAmount);
                      if (!Number.isFinite(n) || n < 0) return;
                      await onSaveAmount(n);
                      setEditingAmount(false);
                    }}
                    disabled={busy}
                    className="px-3 py-2 rounded-lg bg-[#E52828] text-white text-sm disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingAmount(false)}
                    className="px-3 py-2 rounded-lg text-sm text-theme-text-secondary hover:bg-theme-surface-hover"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div>
                  <div className="text-2xl font-semibold text-theme-text">
                    {formatUsd(Number(payout.finalAmountUsd))}
                  </div>
                  {payout.originalCurrency && payout.originalCurrency.toUpperCase() !== 'USD' && (
                    <div className="text-xs text-theme-text-muted mt-0.5">
                      Original: {formatOriginalCurrency(Number(payout.originalAmount), payout.originalCurrency)} ·{' '}
                      Rate: {Number(payout.exchangeRate).toFixed(4)} · Extracted: {formatUsd(Number(payout.extractedAmountUsd))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Per-receipt OCR */}
            {receipts.length > 0 && (
              <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface">
                <h3 className="text-sm font-semibold text-theme-text mb-2">Receipts ({receipts.length})</h3>
                <ul className="space-y-1.5">
                  {receipts.map((r) => {
                    const conf = r.ocrConfidence ?? 0;
                    const lowConf = conf > 0 && conf < 0.8;
                    return (
                      <li key={r.id} className="flex items-center gap-2 text-sm">
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            r.ocrError ? 'bg-red-500' :
                            lowConf ? 'bg-amber-500' :
                            conf >= 0.8 ? 'bg-emerald-500' :
                            'bg-gray-400'
                          }`}
                        />
                        <span className="text-theme-text-muted flex-1 truncate">{r.fileName}</span>
                        {r.ocrError ? (
                          <span className="text-xs text-red-600">{r.ocrError}</span>
                        ) : r.ocrAmount != null && r.ocrCurrency ? (
                          <>
                            <span className="text-theme-text font-medium">
                              {formatOriginalCurrency(Number(r.ocrAmount), r.ocrCurrency)}
                            </span>
                            <span className={`text-xs ${lowConf ? 'text-amber-600' : 'text-theme-text-faint'}`}>
                              {(conf * 100).toFixed(0)}%
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-theme-text-faint">no OCR</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="text-xs text-theme-text-muted mt-2 border-t border-theme-stroke pt-2">
                  Sum of OCR amounts (in their own currencies, not normalized): {ocrSum.toFixed(2)}
                </div>
              </div>
            )}

            {/* Payout target */}
            <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface text-sm space-y-1">
              <h3 className="font-semibold text-theme-text mb-1">
                {payout.payoutMethod
                  ? PAYOUT_METHOD_LABELS[payout.payoutMethod]
                  : 'Payment method not set'}
              </h3>
              {/* arugula-38633 v3 follow-up: when method is null, the host
                  submitted before configuring their PaymentDetailsCard.
                  Admin should ask them to set it (or PATCH the payout). */}
              {payout.payoutMethod == null && (
                <div className="text-xs text-amber-700">
                  Host has not configured their payment details yet. Ask them to set their
                  payment method, or edit this payment via the actions menu before executing.
                </div>
              )}
              {payout.payoutMethod === 'usdc_base' && payout.payoutWalletAddress && (
                <div className="font-mono text-xs break-all text-theme-text-secondary">
                  {payout.payoutWalletAddress}
                </div>
              )}
              {payout.payoutMethod === 'wire' && payout.payoutBankDetails && (
                <pre className="text-xs text-theme-text-secondary whitespace-pre-wrap font-mono">
                  {JSON.stringify(payout.payoutBankDetails, null, 2)}
                </pre>
              )}
              {payout.payoutMethod === 'mercury_card' && (
                <div className="text-xs text-theme-text-secondary">
                  {payout.mercuryCardLast4
                    ? `Card issued — ending in ••••${payout.mercuryCardLast4}`
                    : 'No card issued yet — issue via Mercury dashboard, then mark paid with the last 4.'}
                </div>
              )}
            </div>

            {/* Host notes */}
            {payout.hostNotes && (
              <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface text-sm">
                <h3 className="font-semibold text-theme-text mb-1">Host notes</h3>
                <p className="text-theme-text-secondary whitespace-pre-wrap">{payout.hostNotes}</p>
              </div>
            )}

            {/* External proof (arugula-38633 v2 follow-up) — visible for any
                payout that has an externalProofUrl set, regardless of status. */}
            {payout.externalProofUrl && (
              <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface text-sm">
                <h3 className="font-semibold text-theme-text mb-1">External proof</h3>
                <a
                  href={payout.externalProofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-theme-text-secondary hover:underline break-all"
                >
                  {payout.externalProofUrl}
                  <ExternalLink size={12} />
                </a>
              </div>
            )}

            {/* Admin notes (editable) */}
            <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface">
              <h3 className="font-semibold text-theme-text mb-2 text-sm">Admin notes</h3>
              <IconInput
                icon={Pencil}
                multiline
                rows={3}
                placeholder="Internal notes (visible to admins only)"
                value={adminNotes}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                  setAdminNotes(e.target.value);
                  setAdminNotesDirty(true);
                }}
              />
              {adminNotesDirty && (
                <button
                  type="button"
                  onClick={async () => {
                    await onSaveAdminNotes(adminNotes);
                    setAdminNotesDirty(false);
                  }}
                  disabled={busy || selfPayoutBlocked}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-[#E52828] text-white text-xs disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Save notes'}
                </button>
              )}
            </div>

            {/* Status timeline */}
            <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface">
              <h3 className="font-semibold text-theme-text mb-2 text-sm">Audit trail</h3>
              <ul className="space-y-1.5 text-xs">
                {payout.audits.length === 0 && (
                  <li className="text-theme-text-faint">No audit entries.</li>
                )}
                {payout.audits.map((a) => (
                  <AuditEntry key={a.id} entry={a} />
                ))}
              </ul>
            </div>

            {/* Receipts for already-paid payouts */}
            {isPaid && (
              <div className="rounded-xl border border-emerald-300 p-3 bg-emerald-50 text-sm">
                <h3 className="font-semibold text-emerald-900 mb-1">Payment receipt</h3>
                {payout.transactionHash && (
                  <a
                    href={`https://basescan.org/tx/${payout.transactionHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-800 hover:underline break-all"
                  >
                    {payout.transactionHash}
                    <ExternalLink size={12} />
                  </a>
                )}
                {payout.wireReference && (
                  <div className="text-emerald-800">Wire reference: {payout.wireReference}</div>
                )}
                {payout.mercuryCardLast4 && (
                  <div className="text-emerald-800">
                    Mercury card ••••{payout.mercuryCardLast4}
                    {payout.mercuryCardId && <span className="text-emerald-700/70 ml-2">id: {payout.mercuryCardId}</span>}
                  </div>
                )}
                {payout.externalProofUrl && (
                  <a
                    href={payout.externalProofUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-800 hover:underline break-all"
                  >
                    External proof: {payout.externalProofUrl}
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            )}

            {/* Reject form */}
            {showRejectForm && (
              <div className="rounded-xl border border-red-300 p-3 bg-red-50 text-sm">
                <h3 className="font-semibold text-red-900 mb-2">Reject this payment</h3>
                <IconInput
                  icon={X}
                  multiline
                  rows={2}
                  placeholder="Reason (shown to host)"
                  value={rejectReason}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRejectReason(e.target.value)}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!rejectReason.trim()) return;
                      await onReject(rejectReason.trim());
                      setShowRejectForm(false);
                      setRejectReason('');
                    }}
                    disabled={busy || !rejectReason.trim()}
                    className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs disabled:opacity-50"
                  >
                    Confirm reject
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRejectForm(false)}
                    className="px-3 py-1.5 rounded-lg text-xs text-theme-text-secondary hover:bg-theme-surface-hover"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Execute payout form (PR 5) */}
            {showExecuteForm && (
              <div className="rounded-xl border border-emerald-300 p-3 bg-emerald-50 text-sm space-y-2">
                <h3 className="font-semibold text-emerald-900 mb-1">Execute payment</h3>

                {/* arugula-38633 v3 follow-up: when host submitted without
                    setting a method, execute is blocked until admin (or host)
                    fills it in. The server returns MISSING_PAYOUT_METHOD. */}
                {payout.payoutMethod == null && (
                  <div className="rounded-md bg-amber-100 border border-amber-300 px-3 py-2 text-amber-900">
                    No payment method is set on this payout. Ask the host to set their payment
                    details, or edit this payment to set the method directly, before executing.
                  </div>
                )}

                {payout.payoutMethod === 'usdc_base' && (
                  <div className="space-y-2">
                    <p className="text-emerald-900">
                      Send <strong>{formatUsd(Number(payout.finalAmountUsd))}</strong> USDC on Base to:
                    </p>
                    <p className="font-mono text-xs break-all text-emerald-900/80 bg-white/50 px-2 py-1.5 rounded">
                      {payout.payoutWalletAddress || '(no address set — cannot execute)'}
                    </p>
                    <div className="text-xs text-emerald-800">
                      {usdcCapLoading ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 size={10} className="animate-spin" /> Checking daily cap…
                        </span>
                      ) : usdcCap ? (
                        <>
                          Daily cap remaining: <strong>{formatUsd(usdcCap.remainingUsd)}</strong>{' '}
                          (${usdcCap.usedUsd.toFixed(2)} used of ${usdcCap.capUsd.toFixed(2)} in last 24h)
                        </>
                      ) : (
                        <span className="text-emerald-800/70">Daily cap status unavailable.</span>
                      )}
                    </div>
                  </div>
                )}

                {payout.payoutMethod === 'wire' && (
                  <div className="space-y-2">
                    <p className="text-emerald-900">
                      Confirm that the {formatUsd(Number(payout.finalAmountUsd))} wire has been sent
                      out-of-band, then enter the wire reference number for the audit trail.
                    </p>
                    <IconInput
                      icon={Pencil}
                      placeholder="Wire reference number (required)"
                      value={execWireRef}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExecWireRef(e.target.value)}
                    />
                  </div>
                )}

                {payout.payoutMethod === 'mercury_card' && (
                  <div className="space-y-2">
                    <p className="text-emerald-900">
                      Confirm that the {formatUsd(Number(payout.finalAmountUsd))} Mercury virtual card
                      has been issued via the Mercury dashboard, then record the last 4 digits below.
                    </p>
                    <IconInput
                      icon={Pencil}
                      placeholder="Card last 4 digits (required, exactly 4 numbers)"
                      value={execCardLast4}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setExecCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))
                      }
                      inputMode="numeric"
                      maxLength={4}
                    />
                    <IconInput
                      icon={Pencil}
                      placeholder="Mercury card id (optional)"
                      value={execCardId}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExecCardId(e.target.value)}
                    />
                  </div>
                )}

                {payout.payoutMethod !== 'usdc_base' && (
                  <IconInput
                    icon={Pencil}
                    placeholder="Note (optional)"
                    value={execNote}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExecNote(e.target.value)}
                  />
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      if (payout.payoutMethod === 'wire' && !execWireValid) return;
                      if (payout.payoutMethod === 'mercury_card' && !execMercuryValid) return;
                      if (payout.payoutMethod === 'usdc_base' && !payout.payoutWalletAddress) return;
                      await onExecute({
                        wireReference: payout.payoutMethod === 'wire' ? execWireRef.trim() : undefined,
                        mercuryCardLast4:
                          payout.payoutMethod === 'mercury_card' ? execCardLast4.trim() : undefined,
                        mercuryCardId:
                          payout.payoutMethod === 'mercury_card' && execCardId.trim()
                            ? execCardId.trim()
                            : undefined,
                        note: execNote.trim() || undefined,
                      });
                      setShowExecuteForm(false);
                    }}
                    disabled={
                      busy ||
                      payout.payoutMethod == null ||
                      (payout.payoutMethod === 'wire' && !execWireValid) ||
                      (payout.payoutMethod === 'mercury_card' && !execMercuryValid) ||
                      (payout.payoutMethod === 'usdc_base' && !payout.payoutWalletAddress)
                    }
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {busy && <Loader2 size={12} className="animate-spin" />}
                    {payout.payoutMethod == null ? 'Method not set' :
                      payout.payoutMethod === 'usdc_base' ? 'Send Payment' :
                      payout.payoutMethod === 'wire' ? 'Confirm wire sent' :
                      'Confirm card issued'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowExecuteForm(false)}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg text-xs text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Mark paid form */}
            {showMarkPaidForm && (
              <div className="rounded-xl border border-blue-300 p-3 bg-blue-50 text-sm space-y-2">
                <h3 className="font-semibold text-blue-900 mb-1">Mark as paid (manual)</h3>
                {payout.payoutMethod === 'wire' && (
                  <IconInput
                    icon={Pencil}
                    placeholder="Wire reference number"
                    value={wireRef}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWireRef(e.target.value)}
                  />
                )}
                {payout.payoutMethod === 'usdc_base' && (
                  <IconInput
                    icon={Pencil}
                    placeholder="Transaction hash (0x...)"
                    value={txHash}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTxHash(e.target.value)}
                  />
                )}
                {payout.payoutMethod === 'mercury_card' && (
                  <>
                    <IconInput
                      icon={Pencil}
                      placeholder="Card last 4 digits"
                      value={cardLast4}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCardLast4(e.target.value)}
                    />
                    <IconInput
                      icon={Pencil}
                      placeholder="Mercury card id (optional)"
                      value={cardId}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCardId(e.target.value)}
                    />
                  </>
                )}
                <IconInput
                  icon={Pencil}
                  placeholder="Note (optional)"
                  value={paidNote}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPaidNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await onMarkPaid({
                        wireReference: wireRef.trim() || undefined,
                        transactionHash: txHash.trim() || undefined,
                        mercuryCardLast4: cardLast4.trim() || undefined,
                        mercuryCardId: cardId.trim() || undefined,
                        note: paidNote.trim() || undefined,
                      });
                      setShowMarkPaidForm(false);
                    }}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMarkPaidForm(false)}
                    className="px-3 py-1.5 rounded-lg text-xs text-theme-text-secondary hover:bg-theme-surface-hover"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Footer actions */}
        <div className="border-t border-theme-stroke px-5 py-3 flex items-center gap-2 flex-wrap bg-theme-surface">
          {isPending && (
            <>
              <button
                type="button"
                onClick={() => onApprove()}
                disabled={busy || selfPayoutBlocked}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Approve
              </button>
              <button
                type="button"
                onClick={() => setShowRejectForm(true)}
                disabled={busy || selfPayoutBlocked}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium disabled:opacity-50"
              >
                <X size={14} />
                Reject
              </button>
            </>
          )}
          {isApproved && (
            <>
              <button
                type="button"
                onClick={openExecuteForm}
                disabled={busy || selfPayoutBlocked || showExecuteForm}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
              >
                <Send size={14} />
                {isFailed ? 'Retry Payment' : 'Execute Payment'}
              </button>
              <button
                type="button"
                onClick={() => setShowMarkPaidForm(true)}
                disabled={busy || selfPayoutBlocked}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
              >
                <DollarSign size={14} />
                Mark paid (manual)
              </button>
            </>
          )}
          {isClosed && onReopen && (
            <button
              type="button"
              onClick={() => onReopen()}
              disabled={busy || selfPayoutBlocked}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-theme-surface-hover hover:bg-theme-stroke text-theme-text text-sm font-medium disabled:opacity-50"
            >
              <RefreshCw size={14} />
              Re-open
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-4 py-2 rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover text-sm"
          >
            Close
          </button>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
          onClick={(e) => {
            e.stopPropagation();
            setLightboxUrl(null);
          }}
        >
          <img
            src={lightboxUrl}
            alt=""
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-black/40"
            aria-label="Close lightbox"
          >
            <X size={20} />
          </button>
        </div>
      )}
    </div>
  );
};

const AuditEntry: React.FC<{ entry: PayoutAuditEntry }> = ({ entry }) => {
  const when = new Date(entry.createdAt).toLocaleString();
  return (
    <li className="flex items-start gap-2 text-theme-text-secondary">
      <span className="text-theme-text-faint w-32 flex-shrink-0">{when}</span>
      <span className="flex-1">
        <span className="font-medium text-theme-text">{entry.action}</span>
        {entry.oldStatus && entry.newStatus && (
          <> · {entry.oldStatus} → {entry.newStatus}</>
        )}
        {entry.oldAmount != null && entry.newAmount != null && (
          <> · ${entry.oldAmount} → ${entry.newAmount}</>
        )}
        <> by <span className="text-theme-text">{entry.actorEmail}</span></>
        {entry.note && <div className="text-theme-text-muted text-xs">{entry.note}</div>}
      </span>
    </li>
  );
};
