import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2, AlertCircle, ExternalLink, Pencil, StickyNote, DollarSign, Trash2, Play, ChevronDown, ChevronRight } from 'lucide-react';
import { Payout, PayoutStatus, ReceiptLineItem } from '../../types';
import { cancelPayout, getPayout, updatePayout, fetchAdminMe } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { methodIcon, methodLabel } from './PayoutListRow';
import { IconInput } from '../IconInput';
import { ReceiptUpload, ReceiptItem } from './ReceiptUpload';
import { PizzaPhotoUpload, PizzaPhotoItem } from './PizzaPhotoUpload';
import { CurrencyOverrideSelect } from './CurrencyOverrideSelect';
import { ReceiptLightbox } from '../payments-shared';
import { isVideoFile } from '../../lib/mediaUtils';
import { isPdfFile, derivePdfThumbnailUrl } from '../../lib/pdfUtils';

interface PayoutDetailModalProps {
  partyId: string;
  payoutId: string;
  onClose: () => void;
  /**
   * Optional callback fired after a successful host edit. Lets the parent
   * (PayoutsTab) refresh its list so totals / OCR sums stay in sync.
   */
  onUpdated?: () => void;
  /**
   * gelato-72831: optional callback fired after a successful withdraw so the
   * parent list can drop the row. If provided, the modal will close itself
   * after invoking it.
   */
  onWithdrawn?: (payoutId: string) => void;
}

const STATUS_STYLES: Record<PayoutStatus, string> = {
  pending: 'bg-amber-500/20 text-amber-300',
  approved: 'bg-sky-500/20 text-sky-300',
  rejected: 'bg-red-500/20 text-red-300',
  paid: 'bg-emerald-500/20 text-emerald-300',
  failed: 'bg-red-600/30 text-red-200',
  // ravioli-82931: muted neutral for soft-withdrawn rows (matches PayoutStatusPill aesthetic).
  withdrawn: 'bg-gray-500/20 text-gray-300',
};

const STATUS_LABEL: Record<PayoutStatus, string> = {
  pending: 'Pending review',
  approved: 'Approved — payment pending',
  rejected: 'Rejected',
  paid: 'Paid',
  failed: 'Failed',
  withdrawn: 'Withdrawn',
};

/**
 * capocollo-92111: read-only, expandable per-line-item breakdown rendered
 * under a receipt row in the host payout modal. Self-contained so its
 * open/closed `useState` lives BELOW its own (single, unconditional) hooks —
 * keeping it out of the parent modal, which has early returns and would crash
 * if a hook were declared below them.
 *
 * Display-only: lines an admin marked `ineligible` show struck-through + an
 * amber tag (mirroring the receipt-level ineligible pill in this file). When
 * the receipt has ≥1 ineligible line we render a per-receipt eligible
 * subtotal (sum of the non-ineligible line subtotals); otherwise the subtotal
 * would just duplicate the receipt's `ocrAmount`, so we omit it. Hosts cannot
 * toggle anything here.
 */
const ReceiptLineItems: React.FC<{ items: ReceiptLineItem[] }> = ({ items }) => {
  const { t } = useTranslation('host');
  const [open, setOpen] = useState(false);

  // Eligible total = sum of subtotals for lines NOT marked ineligible. Guard
  // missing/null subtotal by falling back to unitPrice * qty (same fallback as
  // the per-line amount below). Older payloads may omit `ineligible` entirely
  // — treat absent as eligible.
  const lineAmount = (li: ReceiptLineItem): number => {
    if (li.subtotal != null && Number.isFinite(li.subtotal)) return li.subtotal;
    const qty = li.qty && Number.isFinite(li.qty) ? li.qty : 0;
    const unit = li.unitPrice && Number.isFinite(li.unitPrice) ? li.unitPrice : 0;
    return unit * qty;
  };
  const hasIneligible = items.some(li => li.ineligible === true);
  const eligibleTotal = items
    .filter(li => li.ineligible !== true)
    .reduce((sum, li) => sum + lineAmount(li), 0);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[10px] text-theme-text-muted hover:text-theme-text transition-colors"
        aria-expanded={open}
        aria-label={t('payouts.lineItemsToggle')}
        title={t('payouts.lineItemsToggle')}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{t('payouts.lineItemsToggle')} ({items.length})</span>
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-4">
          {items.map((li, i) => {
            const ine = li.ineligible === true;
            const qty = li.qty && Number.isFinite(li.qty) ? li.qty : 0;
            const label = qty > 1 ? `${qty}x ${li.name}` : li.name;
            const amount = lineAmount(li);
            return (
              <li key={i} className="flex items-center justify-between gap-2 text-[11px]">
                <span className={`min-w-0 truncate ${ine ? 'line-through text-theme-text-muted' : 'text-theme-text'}`}>
                  {label}
                </span>
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  {ine && (
                    <span className="text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-amber-500 text-[#ffffff]">
                      {t('payouts.ineligibleLineTag')}
                    </span>
                  )}
                  <span className={ine ? 'line-through text-theme-text-muted' : 'text-theme-text-muted'}>
                    ${amount.toFixed(2)}
                  </span>
                </span>
              </li>
            );
          })}
          {hasIneligible && (
            <li className="flex items-center justify-between gap-2 text-[11px] font-medium border-t border-theme-border mt-1 pt-1">
              <span className="text-theme-text">{t('payouts.eligibleLineTotal')}</span>
              <span className="text-theme-text">${eligibleTotal.toFixed(2)}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

/**
 * Detail view for a single payout. Read-only by default; pending payouts
 * gain an "Edit" affordance that lets the host swap receipts/photos, notes,
 * and amount before an admin reviews.
 */
export const PayoutDetailModal: React.FC<PayoutDetailModalProps> = ({
  partyId,
  payoutId,
  onClose,
  onUpdated,
  onWithdrawn,
}) => {
  const { user } = useAuth();
  const { t } = useTranslation('host');
  const [payout, setPayout] = useState<Payout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // gouda-83912: admin/superadmin viewers may edit any cohost's payout from
  // the host-side modal (mirrors backend `isAnyAdmin` bypass). Non-admin
  // cohosts can only edit their own submissions.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchAdminMe()
      .then(r => { if (!cancelled) setIsAdmin(Boolean(r?.isAdmin)); })
      .catch(() => { /* unauth or non-admin — leave false */ });
    return () => { cancelled = true; };
  }, []);

  // ---- edit state ----
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ---- withdraw state (gelato-72831) ----
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // bresaola-89172: lightbox state for receipt + pizza-photo thumbnails.
  // The carousel combines both kinds so arrow-key nav walks the whole set.
  const [lightboxState, setLightboxState] = useState<{ open: boolean; initialIndex: number }>({
    open: false,
    initialIndex: 0,
  });
  // soppressata-92110: the lightbox owns its own index internally; mirror the
  // currently-displayed index here so we can paint the read-only DUPLICATE /
  // INELIGIBLE banners on the matching doc (admin viewers get the editor, but
  // hosts only see these flags — no toggle).
  const [lightboxCurrentIndex, setLightboxCurrentIndex] = useState(0);

  // New uploads since edit-mode was opened (existing docs aren't re-uploaded).
  const [newReceipts, setNewReceipts] = useState<ReceiptItem[]>([]);
  const [newPizzaPhotos, setNewPizzaPhotos] = useState<PizzaPhotoItem[]>([]);
  // IDs of existing documents the host has clicked X on (deferred until save).
  const [removedDocIds, setRemovedDocIds] = useState<Set<string>>(new Set());
  const [editNotes, setEditNotes] = useState('');
  const [editOverrideAmount, setEditOverrideAmount] = useState<string>('');

  // focaccia-89172: per-existing-document FX overrides keyed by document id.
  // The on-disk `ocrAmount`/`ocrCurrency` columns aren't currently mutable via
  // the host PATCH, so we apply the corrected USD via `editOverrideAmount`
  // when the host saves — the per-doc values stay informational.
  interface DocFxOverride {
    usdAmount: number;
    originalAmount: number;
    originalCurrency: string;
  }
  const [docFxOverrides, setDocFxOverrides] = useState<Record<string, DocFxOverride>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPayout(partyId, payoutId)
      .then(p => { if (!cancelled) setPayout(p); })
      .catch(err => { if (!cancelled) setError(err?.message || 'Failed to load payment'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [partyId, payoutId]);

  // Pre-populate edit fields each time we enter edit mode.
  const enterEdit = () => {
    if (!payout) return;
    setEditing(true);
    setSaveError(null);
    setNewReceipts([]);
    setNewPizzaPhotos([]);
    setRemovedDocIds(new Set());
    setDocFxOverrides({});
    setEditNotes(payout.hostNotes ?? '');
    setEditOverrideAmount(
      payout.finalAmountUsd != null ? String(payout.finalAmountUsd) : ''
    );
  };

  const cancelEdit = () => {
    setEditing(false);
    setSaveError(null);
    setNewReceipts([]);
    setNewPizzaPhotos([]);
    setRemovedDocIds(new Set());
    setDocFxOverrides({});
  };

  // Surviving existing documents (not marked for removal) — drives the
  // photo grids in edit mode so the host can see what's already attached.
  const survivingReceipts = useMemo(
    () => (payout?.documents ?? []).filter(d => d.kind === 'receipt' && !removedDocIds.has(d.id)),
    [payout, removedDocIds]
  );
  const survivingPizzaPhotos = useMemo(
    () => (payout?.documents ?? []).filter(d => d.kind === 'pizza' && !removedDocIds.has(d.id)),
    [payout, removedDocIds]
  );

  // bresaola-89172: unified lightbox list across receipts + pizza photos so
  // arrow-key nav walks the whole set. Receipts listed first (matches the
  // top-down DOM order in read-only mode).
  const viewReceipts = useMemo(
    () => (payout?.documents ?? []).filter(d => d.kind === 'receipt'),
    [payout]
  );
  const viewPizzaPhotos = useMemo(
    () => (payout?.documents ?? []).filter(d => d.kind === 'pizza'),
    [payout]
  );
  // soppressata-92110: keep the doc list parallel to `lightboxImages` so we can
  // look up the flags for whatever index the lightbox is currently showing.
  const lightboxDocs = useMemo(
    () => [...viewReceipts, ...viewPizzaPhotos],
    [viewReceipts, viewPizzaPhotos]
  );
  const lightboxImages = useMemo(
    () =>
      lightboxDocs.map(d => ({
        url: d.url,
        fileName: d.fileName,
        mimeType: d.mimeType,
      })),
    [lightboxDocs]
  );
  const receiptsLightboxOffset = 0;
  const pizzasLightboxOffset = viewReceipts.length;
  // soppressata-92110: the doc currently shown in the lightbox (receipts only
  // carry the flags; pizza photos never do).
  const lightboxCurrentDoc = lightboxDocs[lightboxCurrentIndex] ?? null;

  const isProcessingUploads =
    newReceipts.some(r => r.status === 'uploading' || r.status === 'ocring') ||
    newPizzaPhotos.some(p => p.status === 'uploading');

  // gouda-83912: only the submitter (or any admin) may edit / cancel a payout.
  // Other cohosts on the same party can still see the row but the affordances
  // are hidden — a read-only caption points at the submitter instead.
  const canModify = Boolean(
    payout && (isAdmin || (user?.id != null && user.id === payout.hostUserId))
  );

  // provolone-39042: hosts can edit pending or approved payouts. On approved
  // rows the editable surface is narrowed to receipts/photos only — amount,
  // method, notes are locked (the backend enforces APPROVED_NOT_EDITABLE).
  // paid/rejected/failed remain fully frozen on the host side.
  const isEditableStatus =
    payout?.status === 'pending' || payout?.status === 'approved';
  const isApproved = payout?.status === 'approved';

  const handleSave = async () => {
    if (!payout || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Build the patch payload. Only include fields that actually changed.
      const patch: Parameters<typeof updatePayout>[2] = {};

      // provolone-39042: on approved payouts the notes + amount inputs are
      // hidden; never include them in the patch (backend would reject with
      // APPROVED_NOT_EDITABLE).
      const approvedLocked = payout.status === 'approved';

      // Notes (treat empty string as a clear).
      if (!approvedLocked) {
        const trimmedNotes = editNotes.trim();
        const originalNotes = (payout.hostNotes ?? '').trim();
        if (trimmedNotes !== originalNotes) {
          patch.hostNotes = trimmedNotes.length > 0 ? trimmedNotes : null;
        }
      }

      // Amount override.
      if (!approvedLocked) {
        const amountStr = editOverrideAmount.trim();
        if (amountStr !== '') {
          const parsed = Number(amountStr);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error('Amount must be a positive number');
          }
          if (parsed !== payout.finalAmountUsd) {
            patch.finalAmountUsd = parsed;
          }
        }
      }

      // New uploads only — items must be `done` with a URL.
      const newReceiptPayload = newReceipts
        .filter(r => r.status === 'done' && r.url)
        .map(r => ({
          url: r.url!,
          fileName: r.fileName,
          fileSize: r.fileSize,
          mimeType: r.mimeType,
        }));
      if (newReceiptPayload.length > 0) {
        patch.receiptPhotos = newReceiptPayload;
      }
      const newPizzaPayload = newPizzaPhotos
        .filter(p => p.status === 'done' && p.url)
        .map(p => ({
          url: p.url!,
          fileName: p.fileName,
          fileSize: p.fileSize,
          mimeType: p.mimeType,
        }));
      if (newPizzaPayload.length > 0) {
        patch.pizzaPhotos = newPizzaPayload;
      }

      if (removedDocIds.size > 0) {
        patch.removeDocumentIds = Array.from(removedDocIds);
      }

      if (Object.keys(patch).length === 0) {
        // Nothing to do — just exit edit mode.
        setEditing(false);
        setSaving(false);
        return;
      }

      const updated = await updatePayout(partyId, payoutId, patch);
      setPayout(updated);
      setEditing(false);
      setNewReceipts([]);
      setNewPizzaPhotos([]);
      setRemovedDocIds(new Set());
      onUpdated?.();
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  // gelato-72831: withdraw both pending and approved payouts. Hard-deletes
  // the row server-side (deletion_log trigger keeps audit trail). For approved
  // rows the confirm copy makes clear that resubmitting is the next step.
  const handleWithdraw = async () => {
    if (!payout || withdrawing) return;
    const message = payout.status === 'approved'
      ? 'Withdraw this request? You can submit a new one afterward.'
      : 'Withdraw this payment request? This cannot be undone.';
    if (!confirm(message)) return;
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      const ok = await cancelPayout(partyId, payout.id);
      if (ok) {
        onWithdrawn?.(payout.id);
        onClose();
      }
    } catch (err: any) {
      setWithdrawError(err?.message || 'Failed to withdraw payment');
    } finally {
      setWithdrawing(false);
    }
  };

  // Status-gated withdraw availability. canModify already enforces
  // submitter-or-admin ownership.
  const canWithdraw = Boolean(
    payout &&
    (payout.status === 'pending' || payout.status === 'approved') &&
    canModify
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-theme-stroke">
          <div>
            <h2 className="text-lg font-semibold text-theme-text">
              {editing ? 'Edit payment' : 'Payment details'}
            </h2>
            {payout && (
              <p className="text-xs text-theme-text-muted mt-0.5">
                Submitted {new Date(payout.createdAt).toLocaleString()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {payout && !editing && isEditableStatus && canModify && (
              <button
                type="button"
                onClick={enterEdit}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover transition-colors"
              >
                <Pencil size={14} />
                Edit
              </button>
            )}
            {/* gelato-72831: Withdraw is available for pending AND approved
                rows. Approved means an admin OK'd it but no money has moved;
                hard-deleting still leaves a deletion_log audit trail. */}
            {payout && !editing && canWithdraw && (
              <button
                type="button"
                onClick={handleWithdraw}
                disabled={withdrawing}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md text-theme-text-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                title="Withdraw"
                aria-label="Withdraw payment request"
              >
                {withdrawing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Withdraw
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {loading && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300 inline-flex items-center gap-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          {withdrawError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300 inline-flex items-center gap-2">
              <AlertCircle size={16} /> {withdrawError}
            </div>
          )}

          {payout && !editing && (
            <>
              {/* Status + amount */}
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <p className="text-xs text-theme-text-muted">Amount</p>
                  <p className="text-2xl font-bold text-theme-text">
                    ${payout.finalAmountUsd.toFixed(2)} <span className="text-sm font-normal text-theme-text-muted">USD</span>
                  </p>
                  {payout.originalCurrency !== 'USD' && (
                    <p className="text-xs text-theme-text-muted">
                      from {payout.originalAmount.toLocaleString()} {payout.originalCurrency}
                      {' '}@ {payout.exchangeRate.toFixed(6)} (locked at submission)
                    </p>
                  )}
                  {/* pancetta-37195: surface the cohost who created this payout. */}
                  <p className="text-xs text-theme-text-muted">
                    Submitted by {payout.hostName ?? payout.hostEmail ?? 'Unknown'}
                  </p>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLES[payout.status]}`}>
                  {STATUS_LABEL[payout.status]}
                </span>
              </div>

              {/* gouda-83912: ownership notice for non-owners on editable payouts.
                  Explains why Edit/Cancel buttons aren't shown. provolone-39042
                  extends this to approved rows (which are also host-editable
                  for receipts now). */}
              {isEditableStatus && !canModify && (
                <p className="text-xs text-theme-text-muted">
                  Only {payout.hostName ?? payout.hostEmail ?? 'the submitter'} can modify this.
                </p>
              )}

              {/* Payout method */}
              <div className="rounded-lg bg-theme-surface-hover p-3 text-sm">
                <p className="text-xs text-theme-text-muted mb-1">Payment method</p>
                <p className="inline-flex items-center gap-2 text-theme-text font-medium">
                  {methodIcon(payout.payoutMethod)}
                  {methodLabel(payout.payoutMethod)}
                </p>
                {payout.payoutMethod === 'usdc_base' && payout.payoutWalletAddress && (
                  <p className="text-xs text-theme-text-muted font-mono mt-1">
                    {/* caciotta-92104: show "name.eth -> 0xa1b2..." when the
                        host typed an ENS name. Falls back to the raw address. */}
                    {payout.payoutWalletInput &&
                    payout.payoutWalletInput.toLowerCase() !== payout.payoutWalletAddress.toLowerCase()
                      ? `${payout.payoutWalletInput} → ${payout.payoutWalletAddress}`
                      : payout.payoutWalletAddress}
                  </p>
                )}
                {payout.payoutMethod === 'wire' && payout.payoutBankDetails && (() => {
                  // arugula-38633 (follow-up): wire is now a single email
                  // field. Render the email for new rows; legacy rows still
                  // have the full account-holder + bank-name pair.
                  const b = payout.payoutBankDetails;
                  const legacy = [b.accountHolderName, b.bankName].filter(Boolean).join(' • ');
                  const text = b.email || legacy;
                  return text ? (
                    <p className="text-xs text-theme-text-muted mt-1">{text}</p>
                  ) : null;
                })()}
                {payout.payoutMethod === 'mercury_card' && payout.mercuryCardLast4 && (
                  <p className="text-xs text-theme-text-muted mt-1">
                    Card ending •••• {payout.mercuryCardLast4}
                  </p>
                )}
              </div>

              {/* Notes */}
              {payout.hostNotes && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-1">Your notes</p>
                  <p className="text-sm text-theme-text whitespace-pre-wrap">{payout.hostNotes}</p>
                </div>
              )}
              {payout.rejectionReason && (
                <div>
                  <p className="text-xs text-red-300 mb-1">Rejection reason</p>
                  <p className="text-sm text-theme-text whitespace-pre-wrap">{payout.rejectionReason}</p>
                </div>
              )}

              {/* Receipts (with OCR breakdown) */}
              {viewReceipts.length > 0 && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-2">Receipts</p>
                  <ul className="space-y-2">
                    {viewReceipts.map((d, idx) => {
                      // soppressata-92110: surface (read-only) the admin
                      // exclusion flags. Duplicate wins when both are set —
                      // mirrors the admin grid convention. Hosts can't toggle.
                      const isDup = d.isDuplicate === true;
                      const isIne = d.ineligible === true && !isDup;
                      const flagged = isDup || isIne;
                      return (
                      <li
                        key={d.id}
                        className={`flex items-center gap-3 p-2 rounded-lg bg-theme-surface-hover ${
                          flagged ? 'opacity-60' : ''
                        }`}
                      >
                        {/* bresaola-89172: thumbnail opens the shared lightbox
                            instead of popping the raw URL in a new tab.
                            bocconcino-92104: PDFs render via their sibling
                            `.thumb.png` derived by convention from the
                            canonical URL. */}
                        <button
                          type="button"
                          onClick={() => setLightboxState({ open: true, initialIndex: receiptsLightboxOffset + idx })}
                          className="relative flex-shrink-0 rounded overflow-hidden hover:opacity-80 transition-opacity"
                          aria-label={`Open ${d.fileName}`}
                          title={d.fileName}
                        >
                          <img
                            src={isPdfFile(d) ? derivePdfThumbnailUrl(d.url) : d.url}
                            alt={d.fileName}
                            className="w-14 h-14 object-cover block"
                          />
                          {/* soppressata-92110: diagonal-stripe overlay echoes
                              the lightbox banner so flagged receipts read as
                              "excluded" even at thumbnail size. */}
                          {flagged && (
                            <span
                              className="absolute inset-0 pointer-events-none"
                              style={{
                                backgroundImage: isDup
                                  ? 'repeating-linear-gradient(45deg, rgba(239,68,68,0.30) 0 4px, transparent 4px 8px)'
                                  : 'repeating-linear-gradient(135deg, rgba(245,158,11,0.30) 0 4px, transparent 4px 8px)',
                              }}
                            />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-theme-text truncate">{d.fileName}</p>
                          {d.ocrAmount != null ? (
                            <p className="text-xs text-theme-text-muted">
                              ${d.ocrAmount.toFixed(2)} USD
                              {d.ocrCurrency && d.ocrCurrency !== 'USD' && ` (from ${d.ocrCurrency})`}
                              {d.ocrConfidence != null && ` • ${Math.round(d.ocrConfidence * 100)}% confidence`}
                            </p>
                          ) : d.ocrError ? (
                            <p className="text-xs text-amber-300">OCR failed: {d.ocrError}</p>
                          ) : null}
                          {/* pancetta-37195: per-receipt uploader attribution.
                              Skip the line for historical rows (uploadedByUserId
                              is null) — don't render "Unknown". */}
                          {d.uploadedByUserId && (
                            <p className="text-[10px] text-theme-text-muted truncate">
                              Uploaded by {d.uploadedByName ?? d.uploadedByEmail ?? 'Unknown'}
                            </p>
                          )}
                          {/* capocollo-92111: expandable per-line-item breakdown
                              (read-only). Only rendered when the receipt carries
                              structured OCR line items. Ineligible lines show
                              struck-through + an amber tag; a per-receipt eligible
                              subtotal appears when ≥1 line is ineligible. */}
                          {d.ocrLineItems && d.ocrLineItems.length > 0 && (
                            <ReceiptLineItems items={d.ocrLineItems} />
                          )}
                        </div>
                        {/* soppressata-92110: read-only exclusion pill. Explicit
                            text colors (not theme vars) — this modal portals
                            outside `.gpp-theme` so theme vars don't resolve. */}
                        {isDup && (
                          <span className="flex-shrink-0 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-red-500 text-[#ffffff]">
                            {t('payouts.duplicatePill')}
                          </span>
                        )}
                        {isIne && (
                          <span className="flex-shrink-0 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500 text-[#ffffff]">
                            {t('payouts.ineligiblePill')}
                          </span>
                        )}
                        <a href={d.url} target="_blank" rel="noreferrer" className="p-1 text-theme-text-muted hover:text-theme-text" title="Open raw file">
                          <ExternalLink size={14} />
                        </a>
                      </li>
                      );
                    })}
                  </ul>
                  {/* soppressata-92110: explain why a flagged receipt's amount
                      doesn't count toward the host's reimbursement total. Only
                      shown when at least one receipt is flagged. */}
                  {viewReceipts.some(d => d.isDuplicate === true || d.ineligible === true) && (
                    <p className="text-xs text-theme-text-muted mt-2 italic">
                      {t('payouts.excludedNote')}
                    </p>
                  )}
                </div>
              )}

              {/* Pizza photos */}
              {viewPizzaPhotos.length > 0 && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-2">Pizza / event photos</p>
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                    {viewPizzaPhotos.map((d, idx) => (
                      <div key={d.id} className="space-y-1">
                        {/* bresaola-89172: same lightbox treatment — combined
                            carousel walks receipts then pizza photos. */}
                        <button
                          type="button"
                          onClick={() => setLightboxState({ open: true, initialIndex: pizzasLightboxOffset + idx })}
                          className="relative block w-full aspect-square rounded-lg overflow-hidden bg-theme-surface hover:opacity-90 transition-opacity"
                          aria-label={`Open ${d.fileName}`}
                          title={d.fileName}
                        >
                          {/* melanzane-92103: pizza/event photo entries can
                              be .mp4 videos (per bottarga-92103). Render a
                              <video> with poster-frame metadata + play
                              overlay so admins can tell at-a-glance. */}
                          {isVideoFile(d) ? (
                            <>
                              <video
                                src={d.url}
                                preload="metadata"
                                muted
                                playsInline
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="bg-black/50 rounded-full p-3">
                                  <Play className="text-white" size={20} fill="white" />
                                </div>
                              </div>
                            </>
                          ) : (
                            <img src={d.url} alt={d.fileName} className="w-full h-full object-cover" />
                          )}
                        </button>
                        {/* pancetta-37195: per-photo uploader attribution.
                            Hidden for historical rows (null uploadedByUserId). */}
                        {d.uploadedByUserId && (
                          <p className="text-[10px] text-theme-text-muted truncate">
                            Uploaded by {d.uploadedByName ?? d.uploadedByEmail ?? 'Unknown'}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Receipts of payment */}
              {payout.status === 'paid' && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                  {payout.transactionHash && (
                    <p className="text-theme-text">
                      Paid via USDC on Base —{' '}
                      <a
                        href={`https://basescan.org/tx/${payout.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-300 hover:underline inline-flex items-center gap-1"
                      >
                        view on Basescan <ExternalLink size={12} />
                      </a>
                    </p>
                  )}
                  {payout.wireReference && (
                    <p className="text-theme-text">
                      Wire reference: <span className="font-mono">{payout.wireReference}</span>
                    </p>
                  )}
                  {payout.mercuryCardLast4 && (
                    <p className="text-theme-text">
                      Your Mercury card ending in •••• {payout.mercuryCardLast4} has been issued.
                      Check the email Mercury sent you for full card details.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {payout && editing && (
            <>
              <p className="text-xs text-theme-text-muted">
                {isApproved
                  ? 'This payment is approved. You can still add or remove receipts and pizza photos for record-keeping. Amount and method are locked after approval — contact an admin to change.'
                  : 'You can edit this payment until an admin reviews it. Removed photos are deleted on save.'}
              </p>

              {/* Existing receipts — host can click X to mark for removal */}
              {survivingReceipts.length > 0 && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-2">Existing receipts</p>
                  <ul className="space-y-2">
                    {survivingReceipts.map(d => {
                      // focaccia-89172: apply local FX override (if any) on top
                      // of the stored OCR values so the host sees the corrected
                      // USD inline. The corrected total flows into the amount
                      // override field on save (see onConverted below).
                      const ov = docFxOverrides[d.id];
                      const displayedUsd = ov ? ov.usdAmount : d.ocrAmount;
                      const displayedOriginal = ov ? ov.originalAmount : d.ocrAmount;
                      const displayedCurrency = ov ? ov.originalCurrency : (d.ocrCurrency || 'USD');
                      return (
                        <li key={d.id} className="flex items-center gap-3 p-2 rounded-lg bg-theme-surface-hover">
                          <a href={d.url} target="_blank" rel="noreferrer" className="flex-shrink-0">
                            {/* bocconcino-92104: PDF receipts render via the
                                derived `.thumb.png` sibling — PDFs don't load
                                in <img>. */}
                            <img
                              src={isPdfFile(d) ? derivePdfThumbnailUrl(d.url) : d.url}
                              alt=""
                              className="w-14 h-14 rounded object-cover"
                            />
                          </a>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-theme-text truncate">{d.fileName}</p>
                            {displayedUsd != null && (
                              <div className="text-xs text-theme-text-muted mt-0.5 inline-flex items-center gap-2 flex-wrap">
                                <span>${displayedUsd.toFixed(2)} USD</span>
                                {displayedCurrency !== 'USD' && (
                                  <span>(from {(displayedOriginal ?? 0).toLocaleString()})</span>
                                )}
                                {/* On approved payouts the amount is locked,
                                    so the dropdown wouldn't change anything.
                                    Hide it there. */}
                                {!isApproved && d.ocrAmount != null && (
                                  <CurrencyOverrideSelect
                                    partyId={partyId}
                                    originalAmount={displayedOriginal ?? d.ocrAmount}
                                    currentCurrency={displayedCurrency}
                                    onConverted={result => {
                                      // 1) Remember the override locally so
                                      //    the row re-renders with new values.
                                      setDocFxOverrides(prev => {
                                        const nextOverrides = {
                                          ...prev,
                                          [d.id]: {
                                            usdAmount: result.usdAmount,
                                            originalAmount: result.originalAmount,
                                            originalCurrency: result.originalCurrency,
                                          },
                                        };
                                        // 2) Recompute the total across surviving
                                        //    receipts with overrides applied and
                                        //    push that into the amount-override
                                        //    field so save persists the new sum.
                                        const newTotal = survivingReceipts.reduce((sum, sr) => {
                                          const o = nextOverrides[sr.id];
                                          const usd = o ? o.usdAmount : (sr.ocrAmount ?? 0);
                                          return sum + usd;
                                        }, 0);
                                        if (newTotal > 0) {
                                          setEditOverrideAmount(newTotal.toFixed(2));
                                        }
                                        return nextOverrides;
                                      });
                                    }}
                                  />
                                )}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setRemovedDocIds(prev => new Set(prev).add(d.id))}
                            className="p-1.5 rounded-md text-theme-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            aria-label="Remove receipt"
                          >
                            <X size={16} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Add receipts */}
              <div>
                <p className="text-xs text-theme-text-muted mb-2">Add receipts</p>
                <ReceiptUpload
                  partyId={partyId}
                  payoutTempId={payout.id}
                  items={newReceipts}
                  onChange={setNewReceipts}
                  maxItems={10}
                />
              </div>

              {/* Existing pizza photos — host can click X to mark for removal */}
              {survivingPizzaPhotos.length > 0 && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-2">Existing pizza / event photos</p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                    {survivingPizzaPhotos.map(d => (
                      <div key={d.id} className="relative aspect-square rounded-lg overflow-hidden bg-theme-surface group">
                        {/* melanzane-92103: same video-vs-image swap as the
                            view-mode grid above so edit mode doesn't show
                            an empty tile for .mp4 attachments. */}
                        {isVideoFile(d) ? (
                          <>
                            <video
                              src={d.url}
                              preload="metadata"
                              muted
                              playsInline
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="bg-black/50 rounded-full p-3">
                                <Play className="text-white" size={20} fill="white" />
                              </div>
                            </div>
                          </>
                        ) : (
                          <img src={d.url} alt="" className="w-full h-full object-cover" />
                        )}
                        <button
                          type="button"
                          onClick={() => setRemovedDocIds(prev => new Set(prev).add(d.id))}
                          className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Remove"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add pizza photos */}
              <div>
                <p className="text-xs text-theme-text-muted mb-2">Add pizza / event photos</p>
                <PizzaPhotoUpload
                  partyId={partyId}
                  payoutTempId={payout.id}
                  items={newPizzaPhotos}
                  onChange={setNewPizzaPhotos}
                  maxItems={10}
                />
              </div>

              {/* Notes — locked on approved payouts (provolone-39042). */}
              {!isApproved && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-2">Notes</p>
                  <IconInput
                    icon={StickyNote}
                    multiline
                    rows={3}
                    placeholder="What was this for? Pizza + venue, etc."
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    maxLength={500}
                  />
                  <p className="text-xs text-theme-text-muted mt-1">{editNotes.length}/500</p>
                </div>
              )}

              {/* Amount override — locked on approved payouts (provolone-39042). */}
              {!isApproved && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-2">Amount (USD)</p>
                  <IconInput
                    icon={DollarSign}
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Override amount (USD) — leave blank to recompute from receipts"
                    value={editOverrideAmount}
                    onChange={e => setEditOverrideAmount(e.target.value)}
                  />
                  <p className="text-xs text-theme-text-muted mt-1">
                    If you change receipts, we'll re-add the totals automatically unless you set a value here.
                  </p>
                </div>
              )}

              {saveError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300 inline-flex items-center gap-2">
                  <AlertCircle size={16} /> {saveError}
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="btn-secondary"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || isProcessingUploads}
                  className="btn-primary inline-flex items-center gap-2 justify-center"
                >
                  {saving && <Loader2 size={16} className="animate-spin" />}
                  {isProcessingUploads
                    ? 'Waiting for uploads…'
                    : saving
                    ? 'Saving…'
                    : 'Save changes'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <ReceiptLightbox
        isOpen={lightboxState.open}
        images={lightboxImages}
        initialIndex={lightboxState.initialIndex}
        onClose={() => setLightboxState({ open: false, initialIndex: 0 })}
        onIndexChange={setLightboxCurrentIndex}
        /* soppressata-92110: READ-ONLY duplicate / ineligible banners so hosts
           can see which receipts an admin excluded from their total. No
           onDuplicateShortcut / editorPane — hosts can't toggle these flags.
           Duplicate wins when both are set (pass ineligible only when NOT a
           duplicate), matching the admin convention. */
        isDuplicate={lightboxCurrentDoc?.isDuplicate === true}
        isIneligible={
          lightboxCurrentDoc?.ineligible === true
          && lightboxCurrentDoc?.isDuplicate !== true
        }
      />
    </div>
  );
};
