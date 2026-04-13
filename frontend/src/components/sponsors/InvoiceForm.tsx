import React, { useState, useEffect, useRef } from 'react';
import {
  X, Plus, Trash2, FileText, Send, Save, DollarSign, Building2,
  User, Mail, MapPin, Calendar, Loader2, AlertCircle
} from 'lucide-react';
import { IconInput } from '../IconInput';
import { Sponsor, Invoice, InvoiceLineItem, CreateInvoiceData, UpdateInvoiceData } from '../../types';
import { createInvoice, updateInvoice, sendInvoice } from '../../lib/api';

interface InvoiceFormProps {
  sponsor: Sponsor;
  partyId: string;
  existingInvoice?: Invoice | null;
  onClose: () => void;
  onSave: (invoice: Invoice) => void;
  onSponsorUpdate?: (sponsor: Sponsor) => void;
}

const PAYMENT_TERMS_OPTIONS = [
  'Due on receipt',
  'Net 15',
  'Net 30',
  'Net 60',
];

export function InvoiceForm({ sponsor, partyId, existingInvoice, onClose, onSave, onSponsorUpdate }: InvoiceFormProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSendConfirm, setShowSendConfirm] = useState(false);

  // Form state
  const [billToCompany, setBillToCompany] = useState(existingInvoice?.billToCompany || sponsor.name || '');
  const [billToContact, setBillToContact] = useState(existingInvoice?.billToContact || sponsor.contactName || '');
  const [billToAddress, setBillToAddress] = useState(existingInvoice?.billToAddress || '');
  const [billToEmail, setBillToEmail] = useState(existingInvoice?.billToEmail || sponsor.contactEmail || '');
  const [ccEmails, setCcEmails] = useState(existingInvoice?.ccEmails?.join(', ') || '');
  const [paymentTerms, setPaymentTerms] = useState(existingInvoice?.paymentTerms || '');
  const [paymentInstructions, setPaymentInstructions] = useState(existingInvoice?.paymentInstructions || '');
  const [dueDate, setDueDate] = useState(existingInvoice?.dueDate ? existingInvoice.dueDate.split('T')[0] : '');
  const [memo, setMemo] = useState(existingInvoice?.memo || '');

  // Line items
  const getDefaultLineItems = (): InvoiceLineItem[] => {
    if (existingInvoice?.lineItems && (existingInvoice.lineItems as InvoiceLineItem[]).length > 0) {
      return existingInvoice.lineItems as InvoiceLineItem[];
    }
    // Pre-populate from sponsor amount
    if (sponsor.amount) {
      const amountInCents = Math.round(sponsor.amount * 100);
      return [{
        description: sponsor.sponsorshipType
          ? `${sponsor.sponsorshipType.charAt(0).toUpperCase() + sponsor.sponsorshipType.slice(1)} Sponsorship`
          : 'Sponsorship',
        amount: amountInCents,
      }];
    }
    return [{ description: '', amount: 0 }];
  };

  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>(getDefaultLineItems);

  // Auto-compute total
  const total = lineItems.reduce((sum, item) => sum + (item.amount || 0), 0);

  const formatDollarAmount = (cents: number) => {
    return (cents / 100).toFixed(2);
  };

  const parseDollarAmount = (value: string): number => {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return 0;
    return Math.round(parsed * 100);
  };

  const handleLineItemChange = (index: number, field: 'description' | 'amount', value: string) => {
    setLineItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      if (field === 'amount') {
        return { ...item, amount: parseDollarAmount(value) };
      }
      return { ...item, [field]: value };
    }));
  };

  const addLineItem = () => {
    setLineItems(prev => [...prev, { description: '', amount: 0 }]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length <= 1) return;
    setLineItems(prev => prev.filter((_, i) => i !== index));
  };

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const buildData = (): CreateInvoiceData & UpdateInvoiceData => ({
    sponsorId: sponsor.id,
    billToCompany: billToCompany.trim() || undefined,
    billToContact: billToContact.trim() || undefined,
    billToAddress: billToAddress.trim() || undefined,
    billToEmail: billToEmail.trim(),
    ccEmails: ccEmails.split(',').map(e => e.trim()).filter(Boolean),
    lineItems: lineItems.filter(item => item.description.trim() || item.amount > 0),
    total,
    paymentTerms: paymentTerms || undefined,
    paymentInstructions: paymentInstructions.trim() || undefined,
    dueDate: dueDate || undefined,
    memo: memo.trim() || undefined,
    attachments: existingInvoice?.attachments || [],
  });

  const handleSaveDraft = async () => {
    if (!billToEmail.trim()) {
      setError('Recipient email is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const data = buildData();
      let result;

      if (existingInvoice) {
        result = await updateInvoice(partyId, existingInvoice.id, data);
      } else {
        result = await createInvoice(partyId, data);
      }

      if (result) {
        onSave(result.invoice);
        onClose();
      } else {
        setError('Failed to save invoice');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save invoice');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendInvoice = async () => {
    if (!billToEmail.trim()) {
      setError('Recipient email is required');
      return;
    }

    if (lineItems.filter(item => item.description.trim() && item.amount > 0).length === 0) {
      setError('At least one line item with a description and amount is required');
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      // Save first, then send
      const data = buildData();
      let invoice: Invoice;

      if (existingInvoice) {
        const updateResult = await updateInvoice(partyId, existingInvoice.id, data);
        if (!updateResult) {
          setError('Failed to save invoice');
          return;
        }
        invoice = updateResult.invoice;
      } else {
        const createResult = await createInvoice(partyId, data);
        if (!createResult) {
          setError('Failed to create invoice');
          return;
        }
        invoice = createResult.invoice;
      }

      // Send the invoice
      const isResend = existingInvoice?.status === 'issued' || existingInvoice?.status === 'viewed';
      const sendResult = await sendInvoice(partyId, invoice.id, isResend);

      if (sendResult) {
        onSave(sendResult.invoice);
        // Update sponsor status to billed
        if (onSponsorUpdate) {
          onSponsorUpdate({ ...sponsor, status: 'billed' });
        }
        onClose();
      } else {
        setError('Failed to send invoice');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invoice');
    } finally {
      setIsSending(false);
      setShowSendConfirm(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center overflow-y-auto py-8">
      <div ref={modalRef} className="bg-theme-header border border-theme-stroke rounded-xl w-full max-w-2xl mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-theme-stroke">
          <div className="flex items-center gap-2">
            <FileText size={20} className="text-theme-text-secondary" />
            <h2 className="text-lg font-semibold text-theme-text">
              {existingInvoice ? `Edit Invoice #${existingInvoice.invoiceNumber}` : 'New Invoice'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-theme-text-muted hover:text-theme-text rounded transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {/* Bill To Section */}
          <div>
            <h3 className="text-sm font-medium text-theme-text-secondary mb-2">Bill To</h3>
            <div className="space-y-2">
              <IconInput
                icon={Building2}
                value={billToCompany}
                onChange={e => setBillToCompany(e.target.value)}
                placeholder="Company name"
              />
              <IconInput
                icon={User}
                value={billToContact}
                onChange={e => setBillToContact(e.target.value)}
                placeholder="Contact person"
              />
              <IconInput
                icon={MapPin}
                multiline
                rows={2}
                value={billToAddress}
                onChange={(e: any) => setBillToAddress(e.target.value)}
                placeholder="Address (use semicolons for line breaks)"
              />
              <IconInput
                icon={Mail}
                type="email"
                value={billToEmail}
                onChange={e => setBillToEmail(e.target.value)}
                placeholder="Invoice recipient email"
                required
              />
              <IconInput
                icon={Mail}
                value={ccEmails}
                onChange={e => setCcEmails(e.target.value)}
                placeholder="CC emails, comma-separated"
              />
            </div>
          </div>

          {/* Line Items */}
          <div>
            <h3 className="text-sm font-medium text-theme-text-secondary mb-2">Line Items</h3>
            <div className="space-y-2">
              {lineItems.map((item, index) => (
                <div key={index} className="flex gap-2 items-start">
                  <div className="flex-1">
                    <IconInput
                      icon={FileText}
                      value={item.description}
                      onChange={e => handleLineItemChange(index, 'description', e.target.value)}
                      placeholder="Sponsorship package"
                    />
                  </div>
                  <div className="w-36">
                    <IconInput
                      icon={DollarSign}
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.amount ? formatDollarAmount(item.amount) : ''}
                      onChange={e => handleLineItemChange(index, 'amount', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  {lineItems.length > 1 && (
                    <button
                      onClick={() => removeLineItem(index)}
                      className="p-2 text-theme-text-muted hover:text-red-400 transition-colors mt-0.5"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addLineItem}
              className="flex items-center gap-1 mt-2 px-3 py-1.5 text-xs text-theme-text-secondary hover:text-theme-text bg-theme-surface hover:bg-theme-surface-hover rounded transition-colors"
            >
              <Plus size={14} />
              Add Line Item
            </button>
          </div>

          {/* Total */}
          <div className="flex items-center justify-between p-3 bg-theme-surface rounded-lg">
            <span className="text-sm font-medium text-theme-text-secondary">Total</span>
            <span className="text-lg font-bold text-theme-text">${formatDollarAmount(total)}</span>
          </div>

          {/* Payment Details */}
          <div>
            <h3 className="text-sm font-medium text-theme-text-secondary mb-2">Payment Details</h3>
            <div className="space-y-2">
              <IconInput
                icon={FileText}
                multiline
                rows={2}
                value={paymentInstructions}
                onChange={(e: any) => setPaymentInstructions(e.target.value)}
                placeholder="e.g. 500 USDC to dreadpizzaroberts.eth"
              />

              <div className="relative">
                <select
                  value={paymentTerms}
                  onChange={e => setPaymentTerms(e.target.value)}
                  className="w-full bg-theme-surface border border-theme-stroke rounded-xl px-4 py-2.5 text-theme-text focus:outline-none focus:ring-1 focus:ring-[#ff393a] appearance-none"
                >
                  <option value="">Payment terms...</option>
                  {PAYMENT_TERMS_OPTIONS.map(term => (
                    <option key={term} value={term}>{term}</option>
                  ))}
                </select>
              </div>

              <IconInput
                icon={Calendar}
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                placeholder="Due date"
              />

              <IconInput
                icon={FileText}
                multiline
                rows={2}
                value={memo}
                onChange={(e: any) => setMemo(e.target.value)}
                placeholder="Notes for the partner..."
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-theme-stroke">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-theme-text-secondary hover:text-theme-text transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveDraft}
              disabled={isSaving || isSending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-theme-surface hover:bg-theme-surface-hover border border-theme-stroke text-theme-text rounded-lg transition-colors disabled:opacity-50"
            >
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save Draft
            </button>

            {!showSendConfirm ? (
              <button
                onClick={() => setShowSendConfirm(true)}
                disabled={isSaving || isSending}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#ff393a] hover:bg-[#ff393a]/80 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                <Send size={14} />
                Send Invoice
              </button>
            ) : (
              <button
                onClick={handleSendInvoice}
                disabled={isSaving || isSending}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 animate-pulse"
              >
                {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Confirm Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
