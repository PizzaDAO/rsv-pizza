import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, FileText, Download, AlertCircle } from 'lucide-react';
import { Invoice, InvoiceLineItem } from '../types';
import { getPublicInvoice, recordInvoiceView } from '../lib/api';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();

export function InvoicePage() {
  const { viewToken } = useParams<{ viewToken: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!viewToken) return;

    const loadInvoice = async () => {
      setLoading(true);
      try {
        const result = await getPublicInvoice(viewToken);
        if (result) {
          setInvoice(result.invoice);
          // Record view on first load
          await recordInvoiceView(viewToken);
        } else {
          setError('Invoice not found');
        }
      } catch (err) {
        setError('Failed to load invoice');
      } finally {
        setLoading(false);
      }
    };

    loadInvoice();
  }, [viewToken]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto text-gray-400 mb-4" />
          <h1 className="text-xl font-semibold text-gray-800 mb-2">Invoice Not Found</h1>
          <p className="text-gray-500">{error || 'This invoice link may be invalid or expired.'}</p>
        </div>
      </div>
    );
  }

  const lineItems = (invoice.lineItems || []) as InvoiceLineItem[];

  const formatAmount = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (invoice.currency || 'usd').toUpperCase(),
      minimumFractionDigits: 2,
    }).format(cents / 100);
  };

  const invoiceDate = invoice.sentAt
    ? new Date(invoice.sentAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date(invoice.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const dueDateText = invoice.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const addressLines = invoice.billToAddress
    ? invoice.billToAddress.split(';').map(line => line.trim()).filter(Boolean)
    : [];

  const pdfUrl = `${API_URL}/api/invoice/${viewToken}/pdf`;

  const statusBadge = () => {
    switch (invoice.status) {
      case 'paid':
        return <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-full">Paid</span>;
      case 'issued':
      case 'viewed':
        return <span className="px-3 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded-full">Outstanding</span>;
      case 'draft':
        return <span className="px-3 py-1 bg-gray-100 text-gray-600 text-sm font-medium rounded-full">Draft</span>;
      case 'cancelled':
        return <span className="px-3 py-1 bg-red-100 text-red-600 text-sm font-medium rounded-full">Cancelled</span>;
      default:
        return null;
    }
  };

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .invoice-container { box-shadow: none !important; border: none !important; max-width: 100% !important; }
        }
      `}</style>

      <div className="min-h-screen bg-gray-50 py-8 px-4 print:bg-white print:py-0">
        {/* Action bar */}
        <div className="max-w-3xl mx-auto mb-4 flex items-center justify-between no-print">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <FileText size={16} />
            Invoice #{invoice.invoiceNumber}
            {invoice.party?.name && <span>- {invoice.party.name}</span>}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-gray-800 hover:bg-gray-900 text-white rounded-lg transition-colors"
            >
              <Download size={14} />
              Download PDF
            </a>
          </div>
        </div>

        {/* Invoice */}
        <div className="invoice-container max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="p-8 pb-6">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 mb-1">INVOICE</h1>
                <p className="text-gray-500">{invoice.party?.name || ''}</p>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-3 justify-end mb-2">
                  {statusBadge()}
                </div>
                <p className="text-gray-800 font-semibold">#{invoice.invoiceNumber}</p>
                <p className="text-gray-500 text-sm">Date: {invoiceDate}</p>
                {dueDateText && (
                  <p className="text-gray-500 text-sm">Due: {dueDateText}</p>
                )}
              </div>
            </div>
          </div>

          {/* Bill To */}
          <div className="px-8 pb-6">
            <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2 font-medium">Bill To</h3>
            <div className="text-gray-700">
              {invoice.billToCompany && (
                <p className="font-semibold text-gray-900">{invoice.billToCompany}</p>
              )}
              {invoice.billToContact && (
                <p>ATTN: {invoice.billToContact}</p>
              )}
              {addressLines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              <p>{invoice.billToEmail}</p>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="px-8 pb-6">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-gray-900">
                  <th className="py-3 text-left text-xs uppercase tracking-wider text-gray-500 font-medium">Description</th>
                  <th className="py-3 text-right text-xs uppercase tracking-wider text-gray-500 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item, index) => (
                  <tr key={index} className="border-b border-gray-100">
                    <td className="py-3 text-gray-700">{item.description}</td>
                    <td className="py-3 text-right text-gray-700 whitespace-nowrap">{formatAmount(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-900">
                  <td className="py-4 font-bold text-lg text-gray-900">Total</td>
                  <td className="py-4 text-right font-bold text-lg text-gray-900">{formatAmount(invoice.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Payment Info & Notes */}
          {(invoice.paymentInstructions || invoice.paymentTerms || invoice.memo) && (
            <div className="px-8 pb-8 space-y-4">
              {invoice.paymentInstructions && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-xs uppercase tracking-wider text-gray-400 mb-1 font-medium">Payment Instructions</h4>
                  <p className="text-gray-700 whitespace-pre-wrap">{invoice.paymentInstructions}</p>
                </div>
              )}
              {invoice.paymentTerms && (
                <div>
                  <span className="text-gray-500 text-sm font-medium">Terms: </span>
                  <span className="text-gray-700 text-sm">{invoice.paymentTerms}</span>
                </div>
              )}
              {invoice.memo && (
                <div>
                  <span className="text-gray-500 text-sm font-medium">Note: </span>
                  <span className="text-gray-700 text-sm">{invoice.memo}</span>
                </div>
              )}
            </div>
          )}

          {/* Paid stamp */}
          {invoice.status === 'paid' && (
            <div className="px-8 pb-8">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <p className="text-green-700 font-semibold text-lg">
                  PAID
                  {invoice.paidAt && (
                    <span className="font-normal text-sm text-green-600 ml-2">
                      on {new Date(invoice.paidAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                  )}
                </p>
                {invoice.paymentMethod && (
                  <p className="text-green-600 text-sm mt-1">
                    via {invoice.paymentMethod}
                    {invoice.paymentRef && ` (${invoice.paymentRef})`}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="px-8 py-4 bg-gray-50 border-t border-gray-100 text-center text-xs text-gray-400">
            Generated by <a href="https://rsv.pizza" className="text-gray-500 hover:text-gray-700">RSV.Pizza</a>
          </div>
        </div>
      </div>
    </>
  );
}
