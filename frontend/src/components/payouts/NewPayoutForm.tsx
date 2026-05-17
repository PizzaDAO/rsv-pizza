import React, { useMemo, useState } from 'react';
import { Loader2, StickyNote } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { useAuth } from '../../contexts/AuthContext';
import { Payout, PayoutMethod, BankDetails } from '../../types';
import { createPayout } from '../../lib/api';
import { ReceiptUpload, ReceiptItem } from './ReceiptUpload';
import { PizzaPhotoUpload, PizzaPhotoItem } from './PizzaPhotoUpload';
import { PayoutMethodPicker } from './PayoutMethodPicker';
import { PayoutAmountSummary } from './PayoutAmountSummary';

interface NewPayoutFormProps {
  partyId: string;
  onCreated: (payout: Payout) => void;
  onCancel: () => void;
}

const EMPTY_BANK: BankDetails = {
  accountHolderName: '',
  bankName: '',
};

/**
 * Single-page submission form (no multi-step wizard — matches pizza-faucet-v2).
 *
 * Sections:
 *   1. Receipts (multi-upload + per-receipt OCR preview)
 *   2. Pizza / event photos (multi-upload, no OCR)
 *   3. Notes
 *   4. Amount summary (auto-summed + manual override)
 *   5. Payout method picker
 *   6. Save-as-default
 *   7. Submit
 */
export const NewPayoutForm: React.FC<NewPayoutFormProps> = ({ partyId, onCreated, onCancel }) => {
  const { user } = useAuth();
  // Stable id for this in-flight form, used as the storage-path grouping key.
  const [payoutTempId] = useState(() => `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [pizzaPhotos, setPizzaPhotos] = useState<PizzaPhotoItem[]>([]);
  const [notes, setNotes] = useState('');
  const [overrideAmount, setOverrideAmount] = useState<number | null>(null);

  const [method, setMethod] = useState<PayoutMethod>('mercury_card');
  const [walletAddress, setWalletAddress] = useState('');
  const [bankDetails, setBankDetails] = useState<BankDetails>(EMPTY_BANK);
  const [mercuryCardLast4, setMercuryCardLast4] = useState('');
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const ocrSum = useMemo(
    () => receipts
      .filter(r => r.status === 'done' && r.ocr)
      .reduce((sum, r) => sum + (r.ocr?.amount ?? 0), 0),
    [receipts]
  );
  const finalAmount = overrideAmount != null ? overrideAmount : ocrSum;

  const hasUploadedReceipt = receipts.some(r => r.status === 'done' && r.url);
  const isProcessing = receipts.some(r => r.status === 'uploading' || r.status === 'ocring')
    || pizzaPhotos.some(p => p.status === 'uploading');

  // Method-specific validity
  const methodValid = useMemo(() => {
    if (method === 'usdc_base') {
      return /^0x[0-9a-fA-F]{40}$/.test(walletAddress.trim());
    }
    if (method === 'wire') {
      if (!bankDetails.accountHolderName?.trim() || !bankDetails.bankName?.trim()) return false;
      const hasUs = !!bankDetails.routingNumber?.trim() && !!bankDetails.accountNumber?.trim();
      const hasIntl = !!bankDetails.iban?.trim() || !!bankDetails.swift?.trim();
      return hasUs || hasIntl;
    }
    return true;
  }, [method, walletAddress, bankDetails]);

  const canSubmit = hasUploadedReceipt
    && finalAmount > 0
    && methodValid
    && !isProcessing
    && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createPayout(partyId, {
        receiptPhotos: receipts
          .filter(r => r.status === 'done' && r.url)
          .map(r => ({
            url: r.url!,
            fileName: r.fileName,
            fileSize: r.fileSize,
            mimeType: r.mimeType,
          })),
        pizzaPhotos: pizzaPhotos
          .filter(p => p.status === 'done' && p.url)
          .map(p => ({
            url: p.url!,
            fileName: p.fileName,
            fileSize: p.fileSize,
            mimeType: p.mimeType,
          })),
        hostNotes: notes.trim() || undefined,
        payoutMethod: method,
        ...(method === 'usdc_base' ? { payoutWalletAddress: walletAddress.trim() } : {}),
        ...(method === 'wire' ? { payoutBankDetails: bankDetails } : {}),
        ...(method === 'mercury_card' && mercuryCardLast4
          ? { mercuryCardLast4 }
          : {}),
        ...(overrideAmount != null ? { finalAmountUsd: overrideAmount } : {}),
        saveAsDefault,
      });
      onCreated(created);
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to submit payout');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 1. Receipts */}
      <div className="card p-6">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-theme-text">Receipts</h3>
          <p className="text-xs text-theme-text-muted mt-0.5">
            Upload one receipt per transaction. We'll read each total automatically.
          </p>
        </div>
        <ReceiptUpload
          partyId={partyId}
          payoutTempId={payoutTempId}
          items={receipts}
          onChange={setReceipts}
        />
      </div>

      {/* 2. Pizza photos */}
      <div className="card p-6">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-theme-text">Pizza or event photos</h3>
          <p className="text-xs text-theme-text-muted mt-0.5">
            Optional — proof-of-event photos help your reviewer.
          </p>
        </div>
        <PizzaPhotoUpload
          partyId={partyId}
          payoutTempId={payoutTempId}
          items={pizzaPhotos}
          onChange={setPizzaPhotos}
        />
      </div>

      {/* 3. Notes */}
      <div className="card p-6">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-theme-text">Notes</h3>
        </div>
        <IconInput
          icon={StickyNote}
          multiline
          rows={3}
          placeholder="What was this for? Pizza + venue, etc."
          value={notes}
          onChange={e => setNotes(e.target.value)}
          maxLength={500}
        />
        <p className="text-xs text-theme-text-muted mt-1">{notes.length}/500</p>
      </div>

      {/* 4. Amount summary */}
      <div className="card p-6">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-theme-text">Amount</h3>
        </div>
        <PayoutAmountSummary
          receipts={receipts}
          overrideAmount={overrideAmount}
          onOverrideChange={setOverrideAmount}
        />
      </div>

      {/* 5. Payout method */}
      <div className="card p-6">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-theme-text">How do you want to be paid?</h3>
        </div>
        <PayoutMethodPicker
          method={method}
          onMethodChange={setMethod}
          walletAddress={walletAddress}
          onWalletAddressChange={setWalletAddress}
          bankDetails={bankDetails}
          onBankDetailsChange={setBankDetails}
          userEmail={user?.email}
          amountUsd={finalAmount}
        />

        {/* 6. Save as default */}
        <div className="mt-4">
          <Checkbox
            checked={saveAsDefault}
            onChange={() => setSaveAsDefault(v => !v)}
            label="Use this method for my future payouts too"
          />
        </div>

        {/* Hidden last4 field is intentionally omitted — Mercury card numbers come from admin, not host. */}
        {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
        {false && <input value={mercuryCardLast4} onChange={e => setMercuryCardLast4(e.target.value)} />}
      </div>

      {/* 7. Submit */}
      {submitError && (
        <div className="card p-4 border-red-500/40 bg-red-500/10 text-sm text-red-300">
          {submitError}
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
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
            : `Submit $${finalAmount.toFixed(2)} payout`}
        </button>
      </div>
    </form>
  );
};
