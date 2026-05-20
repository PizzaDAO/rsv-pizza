import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, AlertCircle, ExternalLink, Pencil, StickyNote, DollarSign } from 'lucide-react';
import { Payout, PayoutStatus } from '../../types';
import { getPayout, updatePayout, fetchAdminMe } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { methodIcon, methodLabel } from './PayoutListRow';
import { IconInput } from '../IconInput';
import { ReceiptUpload, ReceiptItem } from './ReceiptUpload';
import { PizzaPhotoUpload, PizzaPhotoItem } from './PizzaPhotoUpload';

interface PayoutDetailModalProps {
  partyId: string;
  payoutId: string;
  onClose: () => void;
  /**
   * Optional callback fired after a successful host edit. Lets the parent
   * (PayoutsTab) refresh its list so totals / OCR sums stay in sync.
   */
  onUpdated?: () => void;
}

const STATUS_STYLES: Record<PayoutStatus, string> = {
  pending: 'bg-amber-500/20 text-amber-300',
  approved: 'bg-sky-500/20 text-sky-300',
  rejected: 'bg-red-500/20 text-red-300',
  paid: 'bg-emerald-500/20 text-emerald-300',
  failed: 'bg-red-600/30 text-red-200',
};

const STATUS_LABEL: Record<PayoutStatus, string> = {
  pending: 'Pending review',
  approved: 'Approved — payment pending',
  rejected: 'Rejected',
  paid: 'Paid',
  failed: 'Failed',
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
}) => {
  const { user } = useAuth();
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

  // New uploads since edit-mode was opened (existing docs aren't re-uploaded).
  const [newReceipts, setNewReceipts] = useState<ReceiptItem[]>([]);
  const [newPizzaPhotos, setNewPizzaPhotos] = useState<PizzaPhotoItem[]>([]);
  // IDs of existing documents the host has clicked X on (deferred until save).
  const [removedDocIds, setRemovedDocIds] = useState<Set<string>>(new Set());
  const [editNotes, setEditNotes] = useState('');
  const [editOverrideAmount, setEditOverrideAmount] = useState<string>('');

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

  const isProcessingUploads =
    newReceipts.some(r => r.status === 'uploading' || r.status === 'ocring') ||
    newPizzaPhotos.some(p => p.status === 'uploading');

  // gouda-83912: only the submitter (or any admin) may edit / cancel a payout.
  // Other cohosts on the same party can still see the row but the affordances
  // are hidden — a read-only caption points at the submitter instead.
  const canModify = Boolean(
    payout && (isAdmin || (user?.id != null && user.id === payout.hostUserId))
  );

  const handleSave = async () => {
    if (!payout || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Build the patch payload. Only include fields that actually changed.
      const patch: Parameters<typeof updatePayout>[2] = {};

      // Notes (treat empty string as a clear).
      const trimmedNotes = editNotes.trim();
      const originalNotes = (payout.hostNotes ?? '').trim();
      if (trimmedNotes !== originalNotes) {
        patch.hostNotes = trimmedNotes.length > 0 ? trimmedNotes : null;
      }

      // Amount override.
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
            {payout && !editing && payout.status === 'pending' && canModify && (
              <button
                type="button"
                onClick={enterEdit}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover transition-colors"
              >
                <Pencil size={14} />
                Edit
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

              {/* gouda-83912: ownership notice for non-owners on pending payouts.
                  Explains why Edit/Cancel buttons aren't shown. */}
              {payout.status === 'pending' && !canModify && (
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
                    {payout.payoutWalletAddress}
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
              {payout.adminNotes && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-1">Reviewer notes</p>
                  <p className="text-sm text-theme-text whitespace-pre-wrap">{payout.adminNotes}</p>
                </div>
              )}
              {payout.rejectionReason && (
                <div>
                  <p className="text-xs text-red-300 mb-1">Rejection reason</p>
                  <p className="text-sm text-theme-text whitespace-pre-wrap">{payout.rejectionReason}</p>
                </div>
              )}

              {/* Receipts (with OCR breakdown) */}
              {payout.documents.some(d => d.kind === 'receipt') && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-2">Receipts</p>
                  <ul className="space-y-2">
                    {payout.documents.filter(d => d.kind === 'receipt').map(d => (
                      <li key={d.id} className="flex items-center gap-3 p-2 rounded-lg bg-theme-surface-hover">
                        <a href={d.url} target="_blank" rel="noreferrer" className="flex-shrink-0">
                          <img src={d.url} alt="" className="w-14 h-14 rounded object-cover" />
                        </a>
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
                        </div>
                        <a href={d.url} target="_blank" rel="noreferrer" className="p-1 text-theme-text-muted hover:text-theme-text">
                          <ExternalLink size={14} />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Pizza photos */}
              {payout.documents.some(d => d.kind === 'pizza') && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-2">Pizza / event photos</p>
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                    {payout.documents.filter(d => d.kind === 'pizza').map(d => (
                      <div key={d.id} className="space-y-1">
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block aspect-square rounded-lg overflow-hidden bg-theme-surface"
                        >
                          <img src={d.url} alt="" className="w-full h-full object-cover hover:opacity-90 transition-opacity" />
                        </a>
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
                You can edit this payment until an admin reviews it. Removed
                photos are deleted on save.
              </p>

              {/* Existing receipts — host can click X to mark for removal */}
              {survivingReceipts.length > 0 && (
                <div>
                  <p className="text-xs text-theme-text-muted mb-2">Existing receipts</p>
                  <ul className="space-y-2">
                    {survivingReceipts.map(d => (
                      <li key={d.id} className="flex items-center gap-3 p-2 rounded-lg bg-theme-surface-hover">
                        <a href={d.url} target="_blank" rel="noreferrer" className="flex-shrink-0">
                          <img src={d.url} alt="" className="w-14 h-14 rounded object-cover" />
                        </a>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-theme-text truncate">{d.fileName}</p>
                          {d.ocrAmount != null && (
                            <p className="text-xs text-theme-text-muted">
                              ${d.ocrAmount.toFixed(2)} USD
                              {d.ocrCurrency && d.ocrCurrency !== 'USD' && ` (from ${d.ocrCurrency})`}
                            </p>
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
                    ))}
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
                        <img src={d.url} alt="" className="w-full h-full object-cover" />
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

              {/* Notes */}
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

              {/* Amount override */}
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
    </div>
  );
};
