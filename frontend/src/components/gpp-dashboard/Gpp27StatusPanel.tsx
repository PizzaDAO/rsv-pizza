import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Clock, Loader2, ShieldCheck } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { updateUnderbossStatus } from '../../lib/api';
import type { Party } from '../../types';

/**
 * diavola-49271: GPP27 host dashboard — slice 4.
 *
 * Single consolidated "Where you stand" panel that re-presents the approval +
 * funding state the 2026 GPPDashboardTab scatters across an Approved tile, a
 * reimbursement-cap tile, and the rejected/listed/hidden callouts. Semantics
 * and copy mirror the live 2026 logic 1:1 — this is a re-presentation, not a
 * reinvention. Rendered above the Next Up card in GPP27DashboardTab.
 */
export const Gpp27StatusPanel: React.FC<{ party: Party }> = ({ party }) => {
  const { t } = useTranslation('host');
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { loadParty } = usePizza();
  const [saving, setSaving] = useState(false);

  const goToPayments = () => {
    if (!inviteCode) return;
    navigate(`/host/${inviteCode}/payments`);
  };

  const setStatus = async (status: 'listed' | 'hidden') => {
    setSaving(true);
    try {
      await updateUnderbossStatus(party.id, status);
      const code = inviteCode ?? party.inviteCode;
      if (code) await loadParty(code);
    } catch (err) {
      console.error('Failed to update status:', err);
    } finally {
      setSaving(false);
    }
  };

  const status = party.underbossStatus ?? 'pending';

  // Cap display rule mirrors GPPDashboardTab: the dollar value shows ONLY when
  // the party has the 'go' event_tag AND a non-null effective cap; otherwise
  // the cap reads "Under review".
  const hasGo = Array.isArray(party.eventTags) && party.eventTags.includes('go');
  const showCap = hasGo && party.effectiveReimbursementCapUsd != null;

  // ---- approved ---------------------------------------------------------
  if (status === 'approved') {
    return (
      <div className="card p-6 border border-green-500/30 bg-green-500/5">
        <div className="flex items-center gap-2 mb-3">
          <Check size={20} className="text-green-400 shrink-0" />
          <h3 className="text-lg font-semibold text-theme-text">
            {t('gpp27.status.approvedTitle')}
          </h3>
        </div>
        <p className="text-sm text-theme-text-muted mb-4">
          {t('gpp27.status.approvedBody')}
        </p>
        <button
          type="button"
          onClick={goToPayments}
          className="w-full text-left rounded-lg border border-theme-stroke bg-theme-surface px-4 py-3 hover:bg-theme-surface-hover transition-colors"
          title={
            showCap
              ? t('gpp27.status.capTitleShown')
              : t('gpp27.status.capTitleReview')
          }
        >
          <div className="text-xs text-theme-text-muted mb-0.5">
            {t('gpp27.status.capLabel')}
          </div>
          {showCap ? (
            <div className="text-2xl font-bold text-theme-text">
              ${Number(party.effectiveReimbursementCapUsd).toLocaleString()}
            </div>
          ) : (
            <div className="text-sm font-medium text-amber-400">
              {t('gpp27.status.capUnderReview')}
            </div>
          )}
        </button>
      </div>
    );
  }

  // ---- rejected ---------------------------------------------------------
  if (status === 'rejected') {
    return (
      <div className="card p-6 border border-amber-500/30 bg-amber-500/5">
        <p className="text-sm text-theme-text mb-4">
          {t('gpp27.status.rejectedBody')}
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => setStatus('listed')}
            disabled={saving}
            className="btn-primary flex items-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {t('gpp27.status.listWithoutFunding')}
          </button>
          <button
            type="button"
            onClick={() => setStatus('hidden')}
            disabled={saving}
            className="btn-secondary flex items-center gap-2"
          >
            {t('gpp27.status.maybeNextYear')}
          </button>
        </div>
      </div>
    );
  }

  // ---- listed -----------------------------------------------------------
  if (status === 'listed') {
    return (
      <div className="card p-6 border border-green-500/30 bg-green-500/5">
        <p className="text-sm text-green-400">{t('gpp27.status.listedBody')}</p>
      </div>
    );
  }

  // ---- hidden -----------------------------------------------------------
  if (status === 'hidden') {
    return (
      <div className="card p-6 border border-theme-stroke">
        <p className="text-sm text-theme-text-muted">{t('gpp27.status.hiddenBody')}</p>
      </div>
    );
  }

  // ---- pending (default) ------------------------------------------------
  return (
    <div className="card p-6 border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-2 mb-2">
        <Clock size={20} className="text-amber-400 shrink-0" />
        <h3 className="text-lg font-semibold text-theme-text">
          {t('gpp27.status.pendingTitle')}
        </h3>
      </div>
      <p className="text-sm text-theme-text-muted inline-flex items-start gap-2">
        <ShieldCheck size={16} className="text-theme-text-secondary shrink-0 mt-0.5" />
        <span>{t('gpp27.status.pendingBody')}</span>
      </p>
    </div>
  );
};
