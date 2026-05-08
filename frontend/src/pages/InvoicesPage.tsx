import React, { useState, useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { IconInput } from '../components/IconInput';
import {
  Search, FileText, Loader2, DollarSign, Send, CheckCircle, Clock,
  Trash2, Eye, RotateCcw, ExternalLink,
} from 'lucide-react';
import {
  fetchAdminMe, fetchTagInvoices, deleteTagInvoice,
  sendTagInvoice, markTagInvoicePaid,
} from '../lib/api';
import type { Invoice, InvoiceStatus } from '../types';

const STATUS_BADGES: Record<InvoiceStatus, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Draft' },
  issued: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Issued' },
  viewed: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Viewed' },
  paid: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Paid' },
  cancelled: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Cancelled' },
};

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function InvoicesPage() {
  const [loading, setLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Mark-paid modal
  const [markPaidId, setMarkPaidId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('usdc');
  const [paymentRef, setPaymentRef] = useState('');

  useEffect(() => {
    async function init() {
      try {
        const me = await fetchAdminMe();
        if (!me.isAdmin) {
          setIsAdminUser(false);
          setLoading(false);
          return;
        }
        setIsAdminUser(true);
        await loadInvoices();
      } catch (err: any) {
        setError(err.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  async function loadInvoices() {
    try {
      const data = await fetchTagInvoices();
      setInvoices(data.invoices);
    } catch (err: any) {
      setError(err.message || 'Failed to load invoices');
    }
  }

  // Available tags from invoice data
  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    invoices.forEach((inv) => {
      if (inv.tag) tags.add(inv.tag);
    });
    return Array.from(tags).sort();
  }, [invoices]);

  // Filter invoices
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (tagFilter !== 'all' && inv.tag !== tagFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        if (
          !inv.invoiceNumber.toLowerCase().includes(s) &&
          !(inv.billToCompany || '').toLowerCase().includes(s) &&
          !(inv.tag || '').toLowerCase().includes(s)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [invoices, statusFilter, tagFilter, search]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this draft invoice?')) return;
    setActionLoading(id);
    try {
      await deleteTagInvoice(id);
      setInvoices((prev) => prev.filter((inv) => inv.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to delete');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSend(id: string) {
    if (!confirm('Send this invoice? It will be marked as issued.')) return;
    setActionLoading(id);
    try {
      const { invoice } = await sendTagInvoice(id);
      setInvoices((prev) => prev.map((inv) => (inv.id === id ? invoice : inv)));
    } catch (err: any) {
      alert(err.message || 'Failed to send');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMarkPaid() {
    if (!markPaidId) return;
    setActionLoading(markPaidId);
    try {
      const { invoice } = await markTagInvoicePaid(markPaidId, {
        paymentMethod,
        paymentRef: paymentRef || undefined,
      });
      setInvoices((prev) => prev.map((inv) => (inv.id === markPaidId ? invoice : inv)));
      setMarkPaidId(null);
      setPaymentRef('');
    } catch (err: any) {
      alert(err.message || 'Failed to mark as paid');
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (!isAdminUser) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white">
        <Header />
        <div className="max-w-4xl mx-auto px-4 py-20 text-center">
          <FileText size={48} className="mx-auto mb-4 text-gray-600" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-gray-400">Admin access is required to view invoices.</p>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Helmet>
        <title>Invoices | RSV.Pizza</title>
      </Helmet>
      <Header />

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <FileText size={24} className="text-[#ff393a]" />
            <h1 className="text-2xl font-bold">Invoices</h1>
          </div>
          <span className="text-sm text-gray-400">
            {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? 's' : ''}
          </span>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="w-64">
            <IconInput
              icon={Search}
              iconSize={14}
              type="text"
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              placeholder="Search by invoice #, company, or tag..."
              className="bg-[#111] border border-white/10 rounded-lg pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-white/20"
          >
            <option value="all">Status: All</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="viewed">Viewed</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {availableTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-white/20"
            >
              <option value="all">Tag: All</option>
              {availableTags.map((t) => (
                <option key={t} value={t}>Tag: {t}</option>
              ))}
            </select>
          )}
        </div>

        {/* Table */}
        {filteredInvoices.length === 0 ? (
          <div className="text-center py-20">
            <FileText size={48} className="mx-auto mb-4 text-gray-700" />
            <p className="text-gray-500">No invoices found</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#111] text-white/50 text-xs uppercase tracking-wider">
                  <th className="text-left py-3 px-4">Invoice #</th>
                  <th className="text-left py-3 px-4">Tag / Partner</th>
                  <th className="text-right py-3 px-4">Total</th>
                  <th className="text-center py-3 px-4">Status</th>
                  <th className="text-left py-3 px-4">Sent</th>
                  <th className="text-left py-3 px-4">Paid</th>
                  <th className="text-left py-3 px-4">Method</th>
                  <th className="text-right py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredInvoices.map((inv) => {
                  const badge = STATUS_BADGES[inv.status as InvoiceStatus] || STATUS_BADGES.draft;
                  const isLoading = actionLoading === inv.id;

                  return (
                    <tr key={inv.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-4">
                        <span className="font-mono text-white/80">{inv.invoiceNumber}</span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col">
                          <span className="text-white/80 capitalize">{inv.tag || '-'}</span>
                          {inv.billToCompany && (
                            <span className="text-xs text-white/40">{inv.billToCompany}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-white/80">
                        {formatCurrency(inv.total)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-white/50 text-xs">{formatDate(inv.sentAt)}</td>
                      <td className="py-3 px-4 text-white/50 text-xs">{formatDate(inv.paidAt)}</td>
                      <td className="py-3 px-4 text-white/50 text-xs uppercase">{inv.paymentMethod || '-'}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          {isLoading ? (
                            <Loader2 size={14} className="animate-spin text-white/40" />
                          ) : (
                            <>
                              {inv.status === 'draft' && (
                                <>
                                  <button
                                    onClick={() => handleSend(inv.id)}
                                    title="Send invoice"
                                    className="p-1.5 rounded hover:bg-white/10 text-blue-400 transition-colors"
                                  >
                                    <Send size={14} />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(inv.id)}
                                    title="Delete draft"
                                    className="p-1.5 rounded hover:bg-white/10 text-red-400 transition-colors"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              )}
                              {(inv.status === 'issued' || inv.status === 'viewed') && (
                                <>
                                  <button
                                    onClick={() => handleSend(inv.id)}
                                    title="Resend"
                                    className="p-1.5 rounded hover:bg-white/10 text-blue-400 transition-colors"
                                  >
                                    <RotateCcw size={14} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setMarkPaidId(inv.id);
                                      setPaymentMethod('usdc');
                                      setPaymentRef('');
                                    }}
                                    title="Mark as paid"
                                    className="p-1.5 rounded hover:bg-white/10 text-green-400 transition-colors"
                                  >
                                    <CheckCircle size={14} />
                                  </button>
                                </>
                              )}
                              {inv.viewToken && (
                                <button
                                  onClick={() => window.open(`/invoice/${inv.viewToken}`, '_blank')}
                                  title="View invoice"
                                  className="p-1.5 rounded hover:bg-white/10 text-white/40 transition-colors"
                                >
                                  <ExternalLink size={14} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Summary row */}
        {filteredInvoices.length > 0 && (
          <div className="flex justify-end mt-4 text-sm text-white/50">
            <div className="flex gap-6">
              <span>
                Total: <span className="text-white font-mono">{formatCurrency(filteredInvoices.reduce((s, i) => s + i.total, 0))}</span>
              </span>
              <span>
                Paid: <span className="text-green-400 font-mono">
                  {formatCurrency(filteredInvoices.filter((i) => i.status === 'paid').reduce((s, i) => s + (i.paidAmount || i.total), 0))}
                </span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Mark Paid Modal */}
      {markPaidId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) setMarkPaidId(null); }}
        >
          <div className="bg-[#1a1a2e] rounded-xl p-6 w-full max-w-md border border-white/10">
            <h3 className="text-lg font-semibold mb-4">Mark Invoice as Paid</h3>

            <div className="space-y-3">
              <div>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
                >
                  <option value="usdc">USDC</option>
                  <option value="wire">Wire Transfer</option>
                  <option value="stripe">Stripe</option>
                  <option value="check">Check</option>
                  <option value="manual">Manual</option>
                </select>
              </div>

              <IconInput
                icon={FileText}
                iconSize={14}
                type="text"
                value={paymentRef}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPaymentRef(e.target.value)}
                placeholder="Payment reference (tx hash, etc.)"
                className="bg-[#111] border border-white/10 rounded-lg pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
              />
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setMarkPaidId(null)}
                className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleMarkPaid}
                disabled={actionLoading === markPaidId}
                className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {actionLoading === markPaidId ? 'Saving...' : 'Confirm Paid'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
