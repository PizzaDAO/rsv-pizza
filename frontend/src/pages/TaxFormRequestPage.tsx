import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { AlertTriangle, CheckCircle2, FileText, Loader2, Lock, XCircle } from 'lucide-react';
import { Layout } from '../components/Layout';
import { TaxFormType } from '../types';
import {
  getPublicTaxFormRequest,
  savePublicTaxFormDraft,
  submitPublicTaxForm,
  PublicTaxFormRequest,
} from '../lib/api';
import { useTaxFormEditor, TaxFormApiAdapter } from '../hooks/useTaxFormEditor';
import { TaxFormPicker } from '../components/payouts/tax/TaxFormPicker';
import { W9Form, W9FormData } from '../components/payouts/tax/W9Form';
import { W8BENForm, W8BENFormData } from '../components/payouts/tax/W8BENForm';
import { W8BENEForm, W8BENEFormData } from '../components/payouts/tax/W8BENEForm';

const FORM_TYPE_LABEL: Record<TaxFormType, string> = {
  w9: 'W-9',
  w8ben: 'W-8BEN',
  w8bene: 'W-8BEN-E',
};

/**
 * calzone-70821: public, token-authed tax-form page (/tax-form?payee=<token>).
 * Reuses the payout-flow form components via useTaxFormEditor with a token
 * API adapter. Never shows a PDF link or echoes a TIN.
 */
export const TaxFormRequestPage: React.FC = () => {
  const [params] = useSearchParams();
  const token = params.get('payee') || '';
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<PublicTaxFormRequest | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const adapter = useMemo<TaxFormApiAdapter>(
    () => ({
      saveDraft: (t, d) => savePublicTaxFormDraft(token, t, d),
      submit: (t, d) => submitPublicTaxForm(token, t, d),
    }),
    [token],
  );
  const editor = useTaxFormEditor(adapter);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    getPublicTaxFormRequest(token)
      .then((r) => {
        if (cancelled) return;
        setInfo(r);
        if (r.currentDraft) {
          editor.startEditing(r.currentDraft.formType, r.currentDraft.formData);
        }
      })
      .catch((e: any) => {
        if (cancelled) return;
        if (e?.code === 'INVALID_TOKEN') setInvalid(true);
        else setLoadError(e?.message || 'Something went wrong. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const switchTo = (target: TaxFormType) => {
    editor.startEditing(target, null);
  };

  const renderBody = () => {
    if (loading) {
      return (
        <div className="card p-6 flex items-center gap-2 text-sm text-theme-text-muted">
          <Loader2 size={16} className="animate-spin" /> Loading...
        </div>
      );
    }
    if (invalid) {
      return (
        <div className="card p-6 flex items-start gap-3">
          <XCircle size={20} className="text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-base font-semibold text-theme-text">This link isn't valid</div>
            <p className="text-sm text-theme-text-muted mt-1">
              It may have been revoked or mistyped. Please contact the person who sent it to you.
            </p>
          </div>
        </div>
      );
    }
    if (loadError || !info) {
      return (
        <div className="card p-6 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-theme-text">{loadError || 'Something went wrong.'}</div>
        </div>
      );
    }
    if (editor.submitted) {
      return (
        <div className="card p-6 flex items-start gap-3">
          <CheckCircle2 size={20} className="text-emerald-400 mt-0.5 flex-shrink-0" />
          <div className="text-base font-semibold text-theme-text">
            Thanks, {info.requester} has your form.
          </div>
        </div>
      );
    }
    if (info.locked) {
      return (
        <div className="card p-6 flex items-start gap-3">
          <Lock size={20} className="text-theme-text-muted mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-base font-semibold text-theme-text">Form already submitted</div>
            <p className="text-sm text-theme-text-muted mt-1">
              {info.requester} has your {info.submittedFormType ? FORM_TYPE_LABEL[info.submittedFormType] : 'tax'} form.
              If something needs to change, please contact them.
            </p>
          </div>
        </div>
      );
    }

    const t = editor.editingType;
    return (
      <div className="space-y-4">
        {info.status === 'rejected' && (
          <div className="card p-3 border-l-4 border-l-red-500 bg-red-500/10 text-sm text-red-200 [.gpp-theme_&]:text-red-800">
            Your previous form was rejected{info.rejectedReason ? `: ${info.rejectedReason}` : '.'} Please fill it in again.
          </div>
        )}
        {!t ? (
          <div className="card p-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-theme-text">
              <FileText size={16} /> Which form applies to you?
            </div>
            {info.suggestedFormType && (
              <p className="text-xs text-theme-text-muted">
                Suggested for you: {FORM_TYPE_LABEL[info.suggestedFormType]}
              </p>
            )}
            <TaxFormPicker value={info.suggestedFormType} onChange={(ft) => editor.startEditing(ft, null)} />
          </div>
        ) : (
          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-theme-text">{FORM_TYPE_LABEL[t]} form</div>
              <button
                type="button"
                className="text-xs text-theme-text-muted underline underline-offset-2 hover:text-theme-text"
                onClick={editor.stopEditing}
              >
                Change form type
              </button>
            </div>
            {t === 'w9' ? (
              <W9Form
                value={editor.draftData as W9FormData}
                onChange={(v) => editor.setDraftData(v)}
                onSwitchFormType={(target) => switchTo(target)}
              />
            ) : t === 'w8ben' ? (
              <W8BENForm
                value={editor.draftData as W8BENFormData}
                onChange={(v) => editor.setDraftData(v)}
                onSwitchFormType={() => switchTo('w9')}
              />
            ) : (
              <W8BENEForm
                value={editor.draftData as W8BENEFormData}
                onChange={(v) => editor.setDraftData(v)}
                onSwitchFormType={() => switchTo('w9')}
              />
            )}
            {editor.error && (
              <div className="card p-3 border-l-4 border-l-red-500 bg-red-500/10 text-xs text-red-200 [.gpp-theme_&]:text-red-800">
                {editor.error}
              </div>
            )}
            {editor.statusMessage && <div className="text-xs text-emerald-300">{editor.statusMessage}</div>}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={editor.saveDraft}
                disabled={editor.saving || editor.submitting}
              >
                {editor.saving && <Loader2 size={14} className="animate-spin mr-2" />}
                Save draft
              </button>
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2 justify-center"
                onClick={editor.submit}
                disabled={editor.saving || editor.submitting}
              >
                {editor.submitting && <Loader2 size={14} className="animate-spin" />}
                Sign and submit
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Layout>
      <Helmet>
        <title>Tax form | RSV.Pizza</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        {info && !invalid && (
          <div>
            <h1 className="text-2xl font-bold text-theme-text">Tax form</h1>
            <p className="text-sm text-theme-text-muted mt-1">
              {info.requester} is requesting a tax form for payments made to you.
            </p>
            <p className="text-sm text-theme-text mt-1">
              Payee: <span className="font-medium">{info.payeeLabel}</span>
              {info.taxYearNote ? <span className="text-theme-text-muted"> ({info.taxYearNote})</span> : null}
            </p>
          </div>
        )}
        {renderBody()}
      </main>
    </Layout>
  );
};
