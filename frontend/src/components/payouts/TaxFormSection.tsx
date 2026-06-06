import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileText, Loader2, ShieldCheck, AlertTriangle, XCircle } from 'lucide-react';
import { TaxForm, TaxFormType } from '../../types';
import {
  getMyTaxForms,
  saveTaxFormDraft,
  submitTaxForm,
} from '../../lib/api';
import { TaxFormPicker } from './tax/TaxFormPicker';
import { W9Form, W9FormData } from './tax/W9Form';
import { W8BENForm, W8BENFormData } from './tax/W8BENForm';
import { W8BENEForm, W8BENEFormData } from './tax/W8BENEForm';

interface TaxFormSectionProps {
  /**
   * If set, force the picker open onto this form type — used when the
   * payout-submit endpoint returns `TAX_FORM_REQUIRED` so we can guide the
   * host to fill the right form immediately.
   */
  autoOpenFormType?: TaxFormType | null;
}

const FORM_TYPE_LABEL: Record<TaxFormType, string> = {
  w9: 'W-9',
  w8ben: 'W-8BEN',
  w8bene: 'W-8BEN-E',
};

/**
 * salame-92110: Tax-form section shown on the NewPayoutForm between Payment
 * method and Submit. Self-contained — fetches the host's tax forms, picks the
 * "current" one (latest draft / submitted of any type), and routes to the
 * appropriate editor.
 */
export const TaxFormSection: React.FC<TaxFormSectionProps> = ({ autoOpenFormType = null }) => {
  // ----- hooks (declared above any early returns per react-hooks rules) -----
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<TaxForm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingType, setEditingType] = useState<TaxFormType | null>(null);
  const [draftData, setDraftData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Pick the "current" form: the latest non-draft (submitted/verified/rejected)
  // OR the latest draft if no live form exists.
  const currentForm = useMemo(() => {
    const live = forms.find((f) => f.status === 'submitted' || f.status === 'verified');
    if (live) return live;
    return forms[0] || null;
  }, [forms]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getMyTaxForms();
      setForms(list);
    } catch (e: any) {
      setError(e?.message || 'Failed to load tax forms');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // When the parent flags TAX_FORM_REQUIRED with a type hint, scroll and open
  // the editor pre-set to that type.
  useEffect(() => {
    if (!autoOpenFormType) return;
    setEditingType(autoOpenFormType);
    setPickerOpen(false);
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [autoOpenFormType]);

  // Seed the editor with existing draft/submitted data when entering edit mode.
  //
  // lonza-92106: default the signature `date` field to today (YYYY-MM-DD) here
  // — at the parent level — so the value is guaranteed to be populated BEFORE
  // any of the form components mount. The prior approach (a mount-effect in
  // each form component) raced with this draft-seed effect: the form mounted
  // with empty value, the mount-effect synchronously called `onChange` with
  // today, then this effect re-fired with the loaded draft (often `date=''`)
  // and overwrote today. Centralising the default eliminates the race for
  // both the no-draft-on-file case (empty `existing.formData`) and the
  // saved-draft-with-blank-date case.
  useEffect(() => {
    if (!editingType) return;
    const existing = forms.find((f) => f.formType === editingType);
    const seeded: Record<string, any> = {
      ...((existing?.formData as Record<string, any>) || {}),
    };
    if (!seeded.date || (typeof seeded.date === 'string' && seeded.date.trim() === '')) {
      seeded.date = new Date().toISOString().slice(0, 10);
    }
    setDraftData(seeded);
  }, [editingType, forms]);

  const handlePick = (formType: TaxFormType) => {
    setEditingType(formType);
    setPickerOpen(false);
  };

  const handleSaveDraft = async () => {
    if (!editingType) return;
    setSaving(true);
    setError(null);
    try {
      await saveTaxFormDraft(editingType, draftData);
      setStatusMessage('Draft saved.');
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to save draft');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!editingType) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitTaxForm(editingType, draftData);
      setStatusMessage('Tax form submitted.');
      setEditingType(null);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to submit tax form');
    } finally {
      setSubmitting(false);
    }
  };

  // ----- early renders (after hooks) -----
  if (loading) {
    return (
      <div ref={sectionRef} className="card p-6 flex items-center gap-2 text-sm text-theme-text-muted">
        <Loader2 size={16} className="animate-spin" />
        Loading tax forms…
      </div>
    );
  }

  // culatello-92107: When a host filling out a W-9 realizes they're foreign,
  // jump them to the right W-8 form. Discard partial W-9 data — the SSN /
  // EIN / exempt-code fields don't translate to W-8BEN(-E), and the parent
  // banner is explicit that they picked the wrong form.
  const handleSwitchFromW9 = (target: 'w8ben' | 'w8bene') => {
    setDraftData({});
    setEditingType(target);
    setPickerOpen(false);
    setError(null);
    setStatusMessage(null);
  };

  // prosciutto-92107: mirror handleSwitchFromW9 for the reverse path. Surfaced
  // from W-8BEN / W-8BEN-E when the host picks a US permanent-residence
  // country (W-8 forms are for foreign persons / entities only). Discards the
  // partial draft for the same reason — the W-8 treaty / chapter4 fields
  // don't translate to W-9.
  const handleSwitchToW9 = (_target: 'w9') => {
    setDraftData({});
    setEditingType('w9');
    setPickerOpen(false);
    setError(null);
    setStatusMessage(null);
  };

  const renderEditor = () => {
    if (!editingType) return null;
    const editorBody =
      editingType === 'w9' ? (
        <W9Form
          value={draftData as W9FormData}
          onChange={(v) => setDraftData(v)}
          onSwitchFormType={handleSwitchFromW9}
        />
      ) : editingType === 'w8ben' ? (
        <W8BENForm
          value={draftData as W8BENFormData}
          onChange={(v) => setDraftData(v)}
          onSwitchFormType={handleSwitchToW9}
        />
      ) : (
        <W8BENEForm
          value={draftData as W8BENEFormData}
          onChange={(v) => setDraftData(v)}
          onSwitchFormType={handleSwitchToW9}
        />
      );
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-theme-text">
            {FORM_TYPE_LABEL[editingType]} form
          </div>
          <button
            type="button"
            className="text-xs text-theme-text-muted underline underline-offset-2 hover:text-theme-text"
            onClick={() => {
              setEditingType(null);
              setPickerOpen(true);
            }}
          >
            Change form type
          </button>
        </div>
        {editorBody}
        {error && (
          <div className="card p-3 border-l-4 border-l-red-500 bg-red-500/10 text-xs text-red-200">
            {error}
          </div>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleSaveDraft}
            disabled={saving || submitting}
          >
            {saving && <Loader2 size={14} className="animate-spin mr-2" />}
            Save draft
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2 justify-center"
            onClick={handleSubmit}
            disabled={saving || submitting}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Submit tax form
          </button>
        </div>
      </div>
    );
  };

  const renderSummary = () => {
    if (!currentForm) {
      return (
        <div className="space-y-3">
          <div className="text-sm text-theme-text-muted">
            No tax form on file. Pick the form type that applies to you.
          </div>
          <TaxFormPicker value={null} onChange={handlePick} />
        </div>
      );
    }
    if (currentForm.status === 'draft') {
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-theme-text">
            <FileText size={16} className="text-theme-text-muted" />
            {FORM_TYPE_LABEL[currentForm.formType]} draft saved — not submitted yet.
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setEditingType(currentForm.formType)}
            >
              Continue editing
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPickerOpen(true)}
            >
              Change type
            </button>
          </div>
          {pickerOpen && (
            <div className="mt-2">
              <TaxFormPicker value={currentForm.formType} onChange={handlePick} />
            </div>
          )}
        </div>
      );
    }
    // submitted | verified | rejected
    const verified = currentForm.status === 'verified';
    const rejected = currentForm.status === 'rejected';
    return (
      <div className="space-y-3">
        <div
          className={[
            'rounded-xl p-3 flex items-start gap-3',
            rejected
              ? 'bg-red-500/10 border border-red-500/30'
              : verified
              ? 'bg-emerald-500/10 border border-emerald-500/30'
              : 'bg-theme-input border border-theme-stroke',
          ].join(' ')}
        >
          {rejected ? (
            <XCircle size={18} className="text-red-300 mt-0.5 flex-shrink-0" />
          ) : verified ? (
            <ShieldCheck size={18} className="text-emerald-300 mt-0.5 flex-shrink-0" />
          ) : (
            <CheckCircle2 size={18} className="text-emerald-300 mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-theme-text">
              {FORM_TYPE_LABEL[currentForm.formType]} —{' '}
              {verified
                ? 'verified by admin'
                : rejected
                ? 'rejected — please resubmit'
                : 'submitted'}
            </div>
            {currentForm.signedAt && (
              <div className="text-xs text-theme-text-muted mt-0.5">
                Signed {new Date(currentForm.signedAt).toLocaleDateString()}
                {currentForm.expiresAt && (
                  <> · expires {new Date(currentForm.expiresAt).toLocaleDateString()}</>
                )}
              </div>
            )}
            {rejected && currentForm.rejectedReason && (
              <div className="text-xs text-red-200 mt-1">
                Reason: {currentForm.rejectedReason}
              </div>
            )}
            {currentForm.pdfUrl && (
              <a
                href={currentForm.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs text-theme-text underline underline-offset-2 mt-1"
              >
                View PDF
              </a>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setEditingType(currentForm.formType)}
          >
            Edit / resubmit
          </button>
          <button
            type="button"
            className="text-xs text-theme-text-muted underline underline-offset-2 hover:text-theme-text"
            onClick={() => setPickerOpen((v) => !v)}
          >
            {pickerOpen ? 'Cancel' : 'Change type'}
          </button>
        </div>
        {pickerOpen && (
          <div className="mt-2">
            <TaxFormPicker value={currentForm.formType} onChange={handlePick} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={sectionRef} className="card p-6 space-y-3" id="tax-form-section">
      <div>
        <h3 className="text-base font-semibold text-theme-text">Tax form</h3>
        <p className="text-xs text-theme-text-muted mt-0.5">
          Required before admin can approve your payouts. US hosts file a W-9; non-US individuals file W-8BEN; non-US organizations file W-8BEN-E.
        </p>
      </div>
      {error && !editingType && (
        <div className="card p-3 border-l-4 border-l-red-500 bg-red-500/10">
          <div className="flex items-start gap-2 text-xs text-red-200">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <div>{error}</div>
          </div>
        </div>
      )}
      {statusMessage && !editingType && (
        <div className="text-xs text-emerald-300">{statusMessage}</div>
      )}
      {editingType ? renderEditor() : renderSummary()}
    </div>
  );
};
