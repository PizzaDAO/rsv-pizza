import { useState, useCallback } from 'react';
import { TaxFormType } from '../types';

/**
 * calzone-70821: the pick -> edit -> save draft -> submit state machine behind
 * the tax-form UI, parameterised by an API adapter so it can drive either the
 * authed user API (/api/tax-forms/*) or the public token API
 * (/api/tax-form-requests/:token/*).
 */
export interface TaxFormApiAdapter {
  saveDraft: (formType: TaxFormType, data: Record<string, any>) => Promise<unknown>;
  submit: (formType: TaxFormType, data: Record<string, any>) => Promise<unknown>;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Default the signature date to today (see lonza-92106 note in TaxFormSection). */
export function seedFormData(existing?: Record<string, any> | null): Record<string, any> {
  const seeded: Record<string, any> = { ...(existing || {}) };
  if (!seeded.date || (typeof seeded.date === 'string' && seeded.date.trim() === '')) {
    seeded.date = today();
  }
  return seeded;
}

export function useTaxFormEditor(adapter: TaxFormApiAdapter) {
  const [editingType, setEditingType] = useState<TaxFormType | null>(null);
  const [draftData, setDraftData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const startEditing = useCallback((formType: TaxFormType, existing?: Record<string, any> | null) => {
    setEditingType(formType);
    setDraftData(seedFormData(existing));
    setError(null);
    setStatusMessage(null);
  }, []);

  const stopEditing = useCallback(() => setEditingType(null), []);

  const saveDraft = useCallback(async () => {
    if (!editingType) return;
    setSaving(true);
    setError(null);
    try {
      await adapter.saveDraft(editingType, draftData);
      setStatusMessage('Draft saved.');
    } catch (e: any) {
      setError(e?.message || 'Failed to save draft');
    } finally {
      setSaving(false);
    }
  }, [adapter, editingType, draftData]);

  const submit = useCallback(async () => {
    if (!editingType) return;
    setSubmitting(true);
    setError(null);
    try {
      await adapter.submit(editingType, draftData);
      setSubmitted(true);
      setEditingType(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to submit tax form');
    } finally {
      setSubmitting(false);
    }
  }, [adapter, editingType, draftData]);

  return {
    editingType, draftData, setDraftData, saving, submitting, submitted,
    error, setError, statusMessage, setStatusMessage,
    startEditing, stopEditing, saveDraft, submit,
  };
}
