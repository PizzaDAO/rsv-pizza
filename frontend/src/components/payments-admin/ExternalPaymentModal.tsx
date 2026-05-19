import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  DollarSign,
  User as UserIcon,
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
} from 'lucide-react';
import { IconInput } from '../IconInput';
import { recordExternalPayment } from '../../lib/api';
import { uploadPayoutPhoto } from '../../lib/supabase';
import type { ExternalPaymentInput, PayoutMethod } from '../../types';

interface ExternalPaymentModalProps {
  onClose: () => void;
  onCreated: () => void;
}

type ExternalMethod = PayoutMethod | 'other';

/**
 * Admin modal for recording payments that happened OUTSIDE the rsv.pizza
 * payouts flow (Venmo, manual bank transfer, etc.). Creates a new payout row
 * in `paid` status immediately so the host's "paid so far" total reflects it
 * and there's an audit trail.
 *
 * No party picker dropdown in v1 — admin pastes the partyId + hostUserId
 * directly (per the plan's "fallback" guidance). Snax can iterate later.
 *
 * arugula-38633 v2 follow-up.
 */
export const ExternalPaymentModal: React.FC<ExternalPaymentModalProps> = ({
  onClose,
  onCreated,
}) => {
  // Form state
  const [partyId, setPartyId] = useState('');
  const [hostUserId, setHostUserId] = useState('');
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

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const amountNum = useMemo(() => Number(amountStr), [amountStr]);

  const canSubmit = useMemo(() => {
    if (!partyId.trim()) return false;
    if (!hostUserId.trim()) return false;
    if (!Number.isFinite(amountNum) || amountNum <= 0) return false;
    if (!adminNotes.trim()) return false;
    return !submitting && !uploading;
  }, [partyId, hostUserId, amountNum, adminNotes, submitting, uploading]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!partyId.trim()) {
      setUploadError('Enter party id first so we can group the upload correctly.');
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
      if (!result) {
        setUploadError('Upload failed — check the file type (jpg/png/webp/heic) and size (<10MB).');
        return;
      }
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

      const body: ExternalPaymentInput = {
        partyId: partyId.trim(),
        hostUserId: hostUserId.trim(),
        finalAmountUsd: amountNum,
        payoutMethod: method,
        paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
        externalProofUrl,
        adminNotes: composedAdminNotes,
      };
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
        className="bg-theme-surface rounded-2xl shadow-2xl border border-theme-stroke w-full max-w-2xl max-h-[95vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-theme-stroke">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-theme-text">Record External Payment</h2>
            <p className="text-xs text-theme-text-muted mt-0.5">
              Use this for payments made OUTSIDE rsv.pizza (Venmo, manual bank, etc.). Creates a paid
              payout row immediately and writes an audit entry.
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
          {/* Party id */}
          <div>
            <IconInput
              icon={Hash}
              placeholder="Party id (uuid) *"
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              required
            />
            <p className="text-xs text-theme-text-muted mt-1">
              Paste the party's UUID — find it in the URL of the admin payouts table or in the party admin page.
            </p>
          </div>

          {/* Host user id */}
          <div>
            <IconInput
              icon={UserIcon}
              placeholder="Host user id (cuid) — who is being reimbursed *"
              value={hostUserId}
              onChange={(e) => setHostUserId(e.target.value)}
              required
            />
            <p className="text-xs text-theme-text-muted mt-1">
              The user id of the host receiving this payment. Admin's responsibility to get right.
            </p>
          </div>

          {/* Amount */}
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
