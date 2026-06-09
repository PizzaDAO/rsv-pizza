import React, { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, AlertTriangle, FileText, XCircle, CheckCircle2 } from 'lucide-react';
import { TaxForm, TaxFormType } from '../../types';
import { getAdminTaxForm, verifyTaxForm, rejectTaxForm } from '../../lib/api';
import { IconInput } from '../IconInput';

interface TaxFormReviewPanelProps {
  /** UUID of the snapshotted tax form on the payout (`payouts.tax_form_id`). */
  taxFormId: string | null;
}

const FORM_LABEL: Record<TaxFormType, string> = {
  w9: 'W-9',
  w8ben: 'W-8BEN',
  w8bene: 'W-8BEN-E',
};

/**
 * salame-92110: admin panel rendered above Receipts in PayoutReviewModal.
 * Shows the host's tax form (W-9 / W-8BEN / W-8BEN-E) with PDF embed +
 * Verify / Reject actions. Renders an amber banner when the payout has no
 * tax form on file (most pre-feature payouts).
 */
export const TaxFormReviewPanel: React.FC<TaxFormReviewPanelProps> = ({ taxFormId }) => {
  // Hooks BEFORE early returns (react-hooks rule).
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<TaxForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!taxFormId) {
      setForm(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAdminTaxForm(taxFormId)
      .then((f) => {
        if (!cancelled) setForm(f);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Failed to load tax form');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taxFormId]);

  const handleVerify = async () => {
    if (!form) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await verifyTaxForm(form.id);
      setForm(updated);
    } catch (e: any) {
      setError(e?.message || 'Failed to verify form');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!form || !reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await rejectTaxForm(form.id, reason.trim());
      setForm(updated);
      setRejectOpen(false);
      setReason('');
    } catch (e: any) {
      setError(e?.message || 'Failed to reject form');
    } finally {
      setSubmitting(false);
    }
  };

  // ----- render -----
  if (!taxFormId) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
        <div className="flex items-start gap-2 text-xs text-amber-100 [.gpp-theme_&]:text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-300" />
          <div>
            <span className="font-semibold">Tax form</span> — host has not submitted a tax form for this payment.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-theme-text inline-flex items-center gap-1.5">
          <FileText size={14} />
          Tax form
        </h3>
        {form && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-theme-surface-hover px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-theme-text-secondary">
              {FORM_LABEL[form.formType]}
            </span>
            <StatusPill status={form.status} />
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-theme-text-muted">
          <Loader2 size={14} className="animate-spin" />
          Loading form…
        </div>
      )}

      {error && (
        <div className="text-xs text-red-300 mb-2">{error}</div>
      )}

      {form && (
        <div className="space-y-2">
          <div className="text-xs text-theme-text-muted">
            {form.user?.name || form.user?.email || form.userId}
            {form.signedAt && (
              <> · signed {new Date(form.signedAt).toLocaleDateString()}</>
            )}
            {form.expiresAt && (
              <> · expires {new Date(form.expiresAt).toLocaleDateString()}</>
            )}
          </div>
          {form.pdfUrl ? (
            <div className="rounded-lg overflow-hidden border border-theme-stroke">
              <embed src={form.pdfUrl} type="application/pdf" className="w-full h-64" />
              <a
                href={form.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-2 py-1 text-xs text-theme-text underline underline-offset-2 hover:text-[#ff393a] bg-theme-surface-hover"
              >
                Open full PDF →
              </a>
            </div>
          ) : (
            <div className="text-xs text-theme-text-muted">No PDF available.</div>
          )}
          {form.status === 'rejected' && form.rejectedReason && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">
              Rejection reason: {form.rejectedReason}
            </div>
          )}

          {form.status === 'submitted' && (
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2"
                onClick={handleVerify}
                disabled={submitting}
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Verify
              </button>
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2"
                onClick={() => setRejectOpen((v) => !v)}
                disabled={submitting}
              >
                <XCircle size={14} />
                Reject
              </button>
            </div>
          )}

          {form.status === 'verified' && (
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <ShieldCheck size={14} />
              Verified
              {form.verifiedBy && <span className="text-theme-text-muted">by {form.verifiedBy}</span>}
            </div>
          )}

          {rejectOpen && form.status === 'submitted' && (
            <div className="mt-2 space-y-2 rounded-lg border border-theme-stroke bg-theme-input p-2">
              <IconInput
                multiline
                rows={2}
                placeholder="Reason for rejection (visible to host)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => {
                    setRejectOpen(false);
                    setReason('');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={handleReject}
                  disabled={submitting || !reason.trim()}
                >
                  {submitting && <Loader2 size={12} className="animate-spin mr-1" />}
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const StatusPill: React.FC<{ status: TaxForm['status'] }> = ({ status }) => {
  const styles: Record<TaxForm['status'], string> = {
    draft: 'bg-theme-surface-hover text-theme-text-muted',
    submitted: 'bg-blue-500/15 text-blue-200',
    verified: 'bg-emerald-500/15 text-emerald-200',
    rejected: 'bg-red-500/15 text-red-200',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[status]}`}
    >
      {status}
    </span>
  );
};
