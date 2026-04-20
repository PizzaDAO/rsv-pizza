import React, { useState } from 'react';
import {
  FileText, Check, Clock, ExternalLink, Copy, Send, DollarSign,
  Loader2, X, MoreHorizontal
} from 'lucide-react';
import { Sponsor, Invoice } from '../../types';
import { markInvoicePaid, sendInvoice } from '../../lib/api';
import { InvoiceForm } from './InvoiceForm';

interface InvoiceButtonProps {
  sponsor: Sponsor;
  partyId: string;
  invoice?: Invoice | null;
  onInvoiceUpdate: (invoice: Invoice) => void;
  onSponsorUpdate: (sponsor: Sponsor) => void;
}

export function InvoiceButton({ sponsor, partyId, invoice, onInvoiceUpdate, onSponsorUpdate }: InvoiceButtonProps) {
  const [showForm, setShowForm] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Mark paid modal state
  const [paymentMethod, setPaymentMethod] = useState('manual');
  const [paymentRef, setPaymentRef] = useState('');

  const invoiceUrl = invoice?.viewToken
    ? `https://rsv.pizza/invoice/${invoice.viewToken}`
    : null;

  const handleCopyUrl = async () => {
    if (!invoiceUrl) return;
    try {
      await navigator.clipboard.writeText(invoiceUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = invoiceUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleResend = async () => {
    if (!invoice) return;
    setLoading(true);
    try {
      const result = await sendInvoice(partyId, invoice.id, true);
      if (result) {
        onInvoiceUpdate(result.invoice);
      }
    } catch (err) {
      console.error('Failed to resend invoice:', err);
    } finally {
      setLoading(false);
      setShowMenu(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!invoice) return;
    setLoading(true);
    try {
      const result = await markInvoicePaid(partyId, invoice.id, {
        paymentMethod,
        paymentRef: paymentRef.trim() || undefined,
      });
      if (result) {
        onInvoiceUpdate(result.invoice);
        onSponsorUpdate({ ...sponsor, status: 'paid' });
      }
    } catch (err) {
      console.error('Failed to mark paid:', err);
    } finally {
      setLoading(false);
      setShowMarkPaid(false);
      setShowMenu(false);
    }
  };

  const formatAmount = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  };

  // Loading state
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-white/40">
        <Loader2 size={12} className="animate-spin" />
      </span>
    );
  }

  // No invoice yet
  if (!invoice) {
    return (
      <>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-theme-text-muted hover:text-theme-text bg-theme-surface hover:bg-theme-surface-hover border border-theme-stroke rounded transition-colors"
          title="Create invoice for this partner"
        >
          <FileText size={12} />
          Invoice
        </button>
        {showForm && (
          <InvoiceForm
            sponsor={sponsor}
            partyId={partyId}
            onClose={() => setShowForm(false)}
            onSave={(inv) => {
              onInvoiceUpdate(inv);
              setShowForm(false);
            }}
            onSponsorUpdate={onSponsorUpdate}
          />
        )}
      </>
    );
  }

  // Draft invoice
  if (invoice.status === 'draft') {
    return (
      <>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-yellow-300 bg-yellow-500/20 rounded cursor-pointer hover:bg-yellow-500/30 transition-colors"
          title="Edit draft invoice"
        >
          <Clock size={12} />
          Draft
        </button>
        {showForm && (
          <InvoiceForm
            sponsor={sponsor}
            partyId={partyId}
            existingInvoice={invoice}
            onClose={() => setShowForm(false)}
            onSave={(inv) => {
              onInvoiceUpdate(inv);
              setShowForm(false);
            }}
            onSponsorUpdate={onSponsorUpdate}
          />
        )}
      </>
    );
  }

  // Paid invoice
  if (invoice.status === 'paid') {
    return (
      <div className="relative inline-flex items-center gap-1">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-green-300 bg-green-500/20 rounded cursor-pointer hover:bg-green-500/30 transition-colors"
          title={`Paid${invoice.paymentMethod ? ` via ${invoice.paymentMethod}` : ''}`}
        >
          <Check size={12} />
          Paid
          {invoice.paidAmount ? ` ${formatAmount(invoice.paidAmount)}` : ''}
        </button>
        {showMenu && (
          <div className="absolute top-full right-0 mt-1 z-10 bg-theme-header border border-theme-stroke rounded-lg shadow-lg py-1 min-w-[140px]">
            {invoiceUrl && (
              <button
                onClick={() => { window.open(invoiceUrl, '_blank'); setShowMenu(false); }}
                className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
              >
                <ExternalLink size={12} />
                View Invoice
              </button>
            )}
            <button
              onClick={handleCopyUrl}
              className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
            >
              {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
        )}
        {showMenu && (
          <div className="fixed inset-0 z-[5]" onClick={() => setShowMenu(false)} />
        )}
      </div>
    );
  }

  // Issued or viewed invoice
  return (
    <div className="relative inline-flex items-center gap-1">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-blue-300 bg-blue-500/20 rounded cursor-pointer hover:bg-blue-500/30 transition-colors"
        title={invoice.status === 'viewed' ? 'Invoice viewed by recipient' : 'Invoice sent'}
      >
        <FileText size={12} />
        {invoice.status === 'viewed' ? 'Viewed' : 'Issued'}
      </button>
      {showMenu && (
        <div className="absolute top-full right-0 mt-1 z-10 bg-theme-header border border-theme-stroke rounded-lg shadow-lg py-1 min-w-[160px]">
          {invoiceUrl && (
            <button
              onClick={() => { window.open(invoiceUrl, '_blank'); setShowMenu(false); }}
              className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
            >
              <ExternalLink size={12} />
              View Invoice
            </button>
          )}
          <button
            onClick={handleCopyUrl}
            className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
          <button
            onClick={handleResend}
            className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
          >
            <Send size={12} />
            Resend
          </button>
          <button
            onClick={() => { setShowMenu(false); setShowForm(true); }}
            className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
          >
            <FileText size={12} />
            Edit Invoice
          </button>
          <button
            onClick={() => { setShowMenu(false); setShowMarkPaid(true); }}
            className="w-full px-3 py-1.5 text-xs text-left text-green-400 hover:bg-green-500/10 transition-colors flex items-center gap-2"
          >
            <DollarSign size={12} />
            Mark Paid
          </button>
        </div>
      )}
      {showMenu && (
        <div className="fixed inset-0 z-[5]" onClick={() => setShowMenu(false)} />
      )}

      {/* Edit form */}
      {showForm && (
        <InvoiceForm
          sponsor={sponsor}
          partyId={partyId}
          existingInvoice={invoice}
          onClose={() => setShowForm(false)}
          onSave={(inv) => {
            onInvoiceUpdate(inv);
            setShowForm(false);
          }}
          onSponsorUpdate={onSponsorUpdate}
        />
      )}

      {/* Mark Paid Modal */}
      {showMarkPaid && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div
            className="bg-theme-header border border-theme-stroke rounded-xl w-full max-w-sm mx-4 p-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-theme-text">Mark Invoice as Paid</h3>
              <button onClick={() => setShowMarkPaid(false)} className="p-1 text-theme-text-muted hover:text-theme-text">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <select
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value)}
                  className="w-full bg-theme-surface border border-theme-stroke rounded-xl px-4 py-2.5 text-sm text-theme-text focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                >
                  <option value="manual">Manual</option>
                  <option value="usdc">USDC</option>
                  <option value="wire">Wire Transfer</option>
                  <option value="stripe">Stripe</option>
                  <option value="check">Check</option>
                </select>
              </div>

              <IconInput
                icon={FileText}
                value={paymentRef}
                onChange={e => setPaymentRef(e.target.value)}
                placeholder="Transaction hash, check #, etc."
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowMarkPaid(false)}
                className="flex-1 px-3 py-2 text-sm text-theme-text-secondary hover:text-theme-text bg-theme-surface rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleMarkPaid}
                disabled={loading}
                className="flex-1 px-3 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Confirm
              </button>
            </div>
          </div>
          <div className="fixed inset-0 z-[-1]" onClick={() => setShowMarkPaid(false)} />
        </div>
      )}
    </div>
  );
}
