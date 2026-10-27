import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import {
  approveFastPassBudget,
  fetchAdminReviewAssist,
  revokeFastPassBudget,
  type AdminReviewAssist,
} from '../../lib/api';

const CATEGORIES = ['pizza', 'drinks', 'venue', 'supplies', 'entertainment', 'other'] as const;

const SEVERITY_STYLE: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-red-100 text-red-800 border-red-300',
  medium: 'bg-amber-100 text-amber-900 border-amber-300',
  low: 'bg-slate-100 text-slate-700 border-slate-300',
};

interface Props {
  partyId: string;
  /** Hide the approve/revoke controls (e.g. when the actor is the host). */
  readOnly?: boolean;
}

/**
 * Admin-only review assist: track record, automated red flags, a review
 * checklist, and (optionally) budget pre-approval. Never pays anything.
 */
export const ReviewAssistPanel: React.FC<Props> = ({ partyId, readOnly }) => {
  const { t } = useTranslation('admin');
  const [data, setData] = useState<AdminReviewAssist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [amount, setAmount] = useState('');
  const [covers, setCovers] = useState<string[]>(['pizza']);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = React.useCallback(() => {
    setError(null);
    fetchAdminReviewAssist(partyId)
      .then(setData)
      .catch((e) => setError(e?.message || t('hostReview.loadFailed')));
  }, [partyId, t]);

  useEffect(load, [load]);

  if (error) return <div className="text-xs text-red-700">{error}</div>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-xs text-theme-text-muted">
        <Loader2 size={12} className="animate-spin" /> {t('hostReview.loading')}
      </div>
    );
  }

  const { track, review, approval } = data;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await approveFastPassBudget(partyId, {
        amountUsd: Number(amount),
        covers,
        note: note.trim() || undefined,
      });
      setAmount('');
      setNote('');
      load();
    } catch (e: any) {
      setError(e?.message || t('hostReview.approveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await revokeFastPassBudget(partyId);
      load();
    } catch (e: any) {
      setError(e?.message || t('hostReview.approveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface space-y-3" data-testid="review-assist">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-theme-text text-sm flex items-center gap-1.5">
          {review.riskLevel === 'low' ? <ShieldCheck size={16} className="text-emerald-600" /> : <ShieldAlert size={16} className="text-red-600" />}
          {t('hostReview.title')}
        </h3>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${SEVERITY_STYLE[review.riskLevel]}`}>
          {t('hostReview.risk', { level: t(`hostReview.level.${review.riskLevel}`) })}
        </span>
      </div>

      <div className="text-xs text-theme-text-secondary">
        {t('hostReview.record', {
          hosted: track.partiesHosted,
          receipts: track.partiesWithOnTimeReceipts,
          photos: track.partiesWithPhotos,
          paid: track.paidWithoutIssues,
          issues: track.issues,
          age: track.accountAgeDays,
        })}
        {data.eligibleForFastPass && (
          <span className="ml-2 inline-flex items-center gap-1 text-amber-700 font-medium">
            <Sparkles size={12} /> {t('hostReview.fastPassEligible')}
          </span>
        )}
      </div>

      {review.flags.length > 0 ? (
        <ul className="space-y-1">
          {review.flags.map((f) => (
            <li key={f.id} className={`text-xs rounded-md border px-2 py-1 ${SEVERITY_STYLE[f.severity]}`}>
              <span className="font-medium">{t(`hostReview.flag.${f.id}`, { defaultValue: f.id })}</span>
              {': '}
              {f.detail}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-emerald-700">{t('hostReview.noFlags')}</p>
      )}

      <div>
        <div className="text-xs font-medium text-theme-text mb-1">{t('hostReview.checklist')}</div>
        <ul className="space-y-1">
          {review.checklist.map((c) => {
            const autoFail = c.auto === false;
            const isChecked = c.auto === true || checked[c.id] === true;
            return (
              <li key={c.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={c.auto !== null}
                  onChange={(e) => setChecked((m) => ({ ...m, [c.id]: e.target.checked }))}
                />
                <span className={autoFail ? 'text-red-700 font-medium' : 'text-theme-text-secondary'}>
                  {t(`hostReview.check.${c.id}`, { defaultValue: c.id })}
                </span>
                {c.auto !== null && (
                  <span className="text-theme-text-faint">({t('hostReview.auto')})</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {!readOnly && (
        <div className="border-t border-theme-stroke pt-3 space-y-2">
          <div className="text-xs font-medium text-theme-text">{t('hostReview.preapprove')}</div>
          {approval ? (
            <div className="text-xs text-theme-text-secondary">
              {t('hostReview.currentApproval', {
                amount: approval.approvedAmountUsd,
                covers: approval.covers.join(', '),
                deadline: new Date(approval.receiptDeadline).toLocaleDateString(),
              })}
              <button
                onClick={revoke}
                disabled={busy}
                className="ml-2 underline text-red-700 disabled:opacity-50"
              >
                {t('hostReview.revoke')}
              </button>
            </div>
          ) : (
            <>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={data.capUsd != null ? t('hostReview.amountCap', { cap: data.capUsd }) : t('hostReview.amount')}
                className="w-full rounded-md border border-theme-stroke px-2 py-1 text-xs bg-transparent"
              />
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <label key={c} className="text-xs flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={covers.includes(c)}
                      onChange={(e) =>
                        setCovers((cur) => (e.target.checked ? [...cur, c] : cur.filter((x) => x !== c)))
                      }
                    />
                    {t(`hostReview.cat.${c}`)}
                  </label>
                ))}
              </div>
              {!data.eligibleForFastPass && (
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('hostReview.noteRequired')}
                  className="w-full rounded-md border border-theme-stroke px-2 py-1 text-xs bg-transparent"
                  rows={2}
                />
              )}
              <button
                onClick={submit}
                disabled={busy || !Number(amount) || covers.length === 0}
                className="px-3 py-1.5 rounded-lg bg-[#E52828] text-white text-xs disabled:opacity-50"
              >
                {busy ? t('hostReview.saving') : t('hostReview.approve')}
              </button>
              <p className="text-[11px] text-theme-text-faint">{t('hostReview.noPayoutNote')}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ReviewAssistPanel;
