import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, StickyNote, Truck, AlertTriangle } from 'lucide-react';
import { IconInput } from '../IconInput';
import { useAuth } from '../../contexts/AuthContext';
import { createPayout } from '../../lib/api';
import { ReceiptUpload, ReceiptItem } from '../payouts/ReceiptUpload';
import { PayoutAmountSummary } from '../payouts/PayoutAmountSummary';
import type { ShippingKit, ShippingPayout } from '../../types';

interface NewShippingReceiptModalProps {
  /**
   * Kits the coordinator can attach the receipt to. Filtered by the parent
   * to those in the coordinator's region; v1 requires a kit selection so we
   * can route the POST to a real partyId.
   */
  kits: ShippingKit[];
  onClose: () => void;
  onCreated: (payout: ShippingPayout) => void;
}

/**
 * salumi-89172: shipping coordinator submits a reimbursement receipt for
 * postage / packing / supplies they paid out of pocket.
 *
 * Reuses the host-side `createPayout` flow (OCR + FX + currency override +
 * notifications) by passing `purpose='shipping'` and the selected kit's id.
 * The POST routes to `/api/parties/{kit.partyId}/payouts` — the kit's
 * parent party is the canonical owner for routing purposes; the backend
 * validates kit ⇄ party correspondence before persisting.
 *
 * Kit selection is required for v1. Untied/general-supplies receipts are
 * deliberately out of scope here.
 */
export const NewShippingReceiptModal: React.FC<NewShippingReceiptModalProps> = ({
  kits,
  onClose,
  onCreated,
}) => {
  const { user } = useAuth();

  // Form state
  const [selectedKitId, setSelectedKitId] = useState<string>('');
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [notes, setNotes] = useState('');
  const [overrideAmount, setOverrideAmount] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reuse the same temp-id grouping NewPayoutForm uses — scoped to a single
  // in-flight submission so uploads sort cleanly under payouts/<partyId>/.
  const [payoutTempId] = useState(
    () => `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  const selectedKit = useMemo(
    () => kits.find(k => k.id === selectedKitId) ?? null,
    [kits, selectedKitId],
  );

  // Filter out placeholder rows (events with no kit request) since they have
  // no real party_kits.id to reference.
  const selectableKits = useMemo(
    () => kits.filter(k => !k.isPlaceholder),
    [kits],
  );

  const ocrSum = useMemo(
    () => receipts
      .filter(r => r.status === 'done' && r.ocr)
      .reduce((sum, r) => sum + (r.ocr?.amount ?? 0), 0),
    [receipts],
  );
  const finalAmount = overrideAmount != null ? overrideAmount : ocrSum;
  const isProcessing = receipts.some(r => r.status === 'uploading' || r.status === 'ocring');

  // Saved payout method (same logic as host NewPayoutForm — coordinator
  // configures their method via /payments PaymentDetailsCard, or admin sets
  // it for them).
  const savedMethod = user?.preferredPayoutMethod ?? null;
  const savedWallet = user?.payoutWalletAddress ?? null;
  const savedBank = user?.payoutBankDetails ?? null;
  const savedMethodValid = useMemo(() => {
    if (savedMethod == null) return false;
    if (savedMethod === 'usdc_base') {
      return !!savedWallet && /^0x[0-9a-fA-F]{40}$/.test(savedWallet.trim());
    }
    if (savedMethod === 'wire') {
      if (!savedBank) return false;
      const email = savedBank.email?.trim() ?? '';
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return true;
      if (!savedBank.accountHolderName?.trim() || !savedBank.bankName?.trim()) return false;
      const hasUs = !!savedBank.routingNumber?.trim() && !!savedBank.accountNumber?.trim();
      const hasIntl = !!savedBank.iban?.trim() || !!savedBank.swift?.trim();
      return hasUs || hasIntl;
    }
    return true;
  }, [savedMethod, savedWallet, savedBank]);

  const canSubmit =
    !!selectedKit &&
    finalAmount > 0 &&
    !isProcessing &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selectedKit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const forwardMethod = savedMethod && savedMethodValid;
      const created = (await createPayout(selectedKit.partyId, {
        receiptPhotos: receipts
          .filter(r => r.status === 'done' && r.url)
          .map(r => ({
            url: r.url!,
            fileName: r.fileName,
            fileSize: r.fileSize,
            mimeType: r.mimeType,
          })),
        // Shipping receipts don't carry pizza/event proof photos.
        pizzaPhotos: [],
        hostNotes: notes.trim() || undefined,
        purpose: 'shipping',
        partyKitId: selectedKit.id,
        ...(forwardMethod
          ? {
              payoutMethod: savedMethod!,
              ...(savedMethod === 'usdc_base' && savedWallet
                ? { payoutWalletAddress: savedWallet.trim() }
                : {}),
              ...(savedMethod === 'wire' && savedBank
                ? { payoutBankDetails: savedBank }
                : {}),
              saveAsDefault: true,
            }
          : {}),
        ...(overrideAmount != null ? { finalAmountUsd: overrideAmount } : {}),
      })) as unknown as ShippingPayout;
      onCreated(created);
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to submit receipt');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4"
      onClick={onClose}
    >
      <div
        className="bg-theme-card border border-theme-stroke rounded-2xl p-6 w-full max-w-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-theme-text inline-flex items-center gap-2">
            <Truck size={20} />
            New shipping receipt
          </h3>
          <button
            onClick={onClose}
            className="text-theme-text-faint hover:text-theme-text-secondary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* 1. Kit selection (required) */}
          <div>
            <div className="mb-2">
              <h4 className="text-sm font-semibold text-theme-text">Tied to event</h4>
              <p className="text-xs text-theme-text-muted mt-0.5">
                Pick the kit this receipt belongs to. (Required for v1.)
              </p>
            </div>
            <select
              value={selectedKitId}
              onChange={(e) => setSelectedKitId(e.target.value)}
              className="w-full h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text"
              required
              aria-label="Pick the kit this receipt is tied to"
            >
              <option value="">Select a kit…</option>
              {selectableKits.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.partyName} — {k.recipientName}, {k.city}
                  {k.country ? `, ${k.country}` : ''}
                </option>
              ))}
            </select>
            {selectableKits.length === 0 && (
              <p className="text-xs text-amber-300 mt-1.5 inline-flex items-start gap-1">
                <AlertTriangle size={12} className="mt-0.5" />
                No kits in your region yet.
              </p>
            )}
          </div>

          {/* 2. Receipts (OCR + FX) */}
          {selectedKit && (
            <div>
              <div className="mb-2">
                <h4 className="text-sm font-semibold text-theme-text">Receipts</h4>
                <p className="text-xs text-theme-text-muted mt-0.5">
                  Upload your postage / packing / supply receipts. We'll add them up.
                </p>
              </div>
              <ReceiptUpload
                partyId={selectedKit.partyId}
                payoutTempId={payoutTempId}
                items={receipts}
                onChange={setReceipts}
              />
            </div>
          )}

          {/* 3. Notes */}
          <div>
            <div className="mb-2">
              <h4 className="text-sm font-semibold text-theme-text">Notes</h4>
            </div>
            <IconInput
              icon={StickyNote}
              multiline
              rows={3}
              placeholder="What was this for? Postage, packing, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
            <p className="text-xs text-theme-text-muted mt-1">{notes.length}/500</p>
          </div>

          {/* 4. Amount summary */}
          <div>
            <div className="mb-2">
              <h4 className="text-sm font-semibold text-theme-text">Amount</h4>
            </div>
            <PayoutAmountSummary
              receipts={receipts}
              overrideAmount={overrideAmount}
              onOverrideChange={setOverrideAmount}
            />
          </div>

          {submitError && (
            <div className="card p-3 border-red-500/40 bg-red-500/10 text-sm text-red-300">
              {submitError}
            </div>
          )}

          {/* No-method warning (informational) */}
          {!savedMethodValid && (
            <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/10 text-sm text-amber-100 inline-flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Your payment method isn't set yet. You can still submit — admin will
                request it before paying.
              </span>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="btn-primary inline-flex items-center gap-2 justify-center"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {isProcessing
                ? 'Waiting for uploads…'
                : submitting
                ? 'Submitting…'
                : `Submit $${finalAmount.toFixed(2)} receipt`}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
};
