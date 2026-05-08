import React, { useState, useEffect, useMemo } from 'react';
import { X, Loader2, Building2, User, Mail, AtSign, FileText, DollarSign, Calendar, MessageSquare } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { fetchTagInvoiceEvents, createTagInvoice } from '../../lib/api';
import type { TagInvoiceEvent, InvoiceLineItem } from '../../types';

interface TagInvoiceCreatorProps {
  tag: string;
  onClose: () => void;
  onCreated?: () => void;
}

interface CityLineItem {
  event: TagInvoiceEvent;
  included: boolean;
  amount: number; // in dollars (display)
}

export function TagInvoiceCreator({ tag, onClose, onCreated }: TagInvoiceCreatorProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bill-to fields
  const [billToCompany, setBillToCompany] = useState('');
  const [billToContact, setBillToContact] = useState('');
  const [billToEmail, setBillToEmail] = useState('');
  const [ccEmails, setCcEmails] = useState('');

  // Line items
  const [cityItems, setCityItems] = useState<CityLineItem[]>([]);

  // Payment fields
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Due on receipt');
  const [dueDate, setDueDate] = useState('');
  const [memo, setMemo] = useState('');

  // Load events and sponsor user data
  useEffect(() => {
    async function load() {
      try {
        const data = await fetchTagInvoiceEvents(tag);

        // Pre-populate bill-to from SponsorUser
        if (data.sponsorUser) {
          setBillToCompany(data.sponsorUser.coHostName || '');
          setBillToContact(data.sponsorUser.name || '');
          setBillToEmail(data.sponsorUser.email || '');
        }

        // Set up city line items with suggested pricing
        setCityItems(
          data.events.map((event) => ({
            event,
            included: true,
            amount: event.suggestedPrice,
          }))
        );

        // Default payment instructions
        const total = data.events.reduce((s, e) => s + e.suggestedPrice, 0);
        setPaymentInstructions(
          `${total.toLocaleString()} USDC to dreadpizzaroberts.eth`
        );
      } catch (err: any) {
        setError(err.message || 'Failed to load events');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [tag]);

  // Compute total
  const total = useMemo(() => {
    return cityItems
      .filter((c) => c.included)
      .reduce((sum, c) => sum + c.amount, 0);
  }, [cityItems]);

  // Update payment instructions when total changes
  useEffect(() => {
    if (total > 0) {
      setPaymentInstructions(
        `${total.toLocaleString()} USDC to dreadpizzaroberts.eth`
      );
    }
  }, [total]);

  function toggleCity(index: number) {
    setCityItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, included: !item.included } : item
      )
    );
  }

  function updateAmount(index: number, value: string) {
    const num = parseFloat(value) || 0;
    setCityItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, amount: num } : item
      )
    );
  }

  async function handleSave(send: boolean) {
    setError(null);
    setSaving(true);
    try {
      const includedItems = cityItems.filter((c) => c.included);
      if (includedItems.length === 0) {
        setError('Select at least one city');
        setSaving(false);
        return;
      }
      if (!billToEmail) {
        setError('Bill-to email is required');
        setSaving(false);
        return;
      }

      const lineItems: InvoiceLineItem[] = includedItems.map((item) => ({
        partyId: item.event.id,
        description: item.event.name,
        amount: Math.round(item.amount * 100), // Convert dollars to cents
      }));

      const ccList = ccEmails
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);

      const { invoice } = await createTagInvoice({
        tag,
        lineItems,
        paymentTerms,
        paymentInstructions,
        memo: memo || undefined,
        dueDate: dueDate || undefined,
        billToCompany: billToCompany || undefined,
        billToContact: billToContact || undefined,
        billToEmail,
        ccEmails: ccList.length > 0 ? ccList : undefined,
      });

      if (send && invoice) {
        // Send immediately after creation
        const { sendTagInvoice: sendInvoice } = await import('../../lib/api');
        await sendInvoice(invoice.id);
      }

      onCreated?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 overflow-y-auto p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#1a1a2e] rounded-xl w-full max-w-2xl border border-white/10 my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold capitalize">
            Invoice for {tag}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : (
          <div className="px-6 py-4 space-y-6 max-h-[80vh] overflow-y-auto">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Bill To Section */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">Bill To</h3>
              <div className="grid grid-cols-2 gap-2">
                <IconInput
                  icon={Building2}
                  iconSize={14}
                  type="text"
                  value={billToCompany}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBillToCompany(e.target.value)}
                  placeholder="Company name"
                  className="bg-[#111] border border-white/10 rounded-lg pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
                />
                <IconInput
                  icon={User}
                  iconSize={14}
                  type="text"
                  value={billToContact}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBillToContact(e.target.value)}
                  placeholder="Contact person"
                  className="bg-[#111] border border-white/10 rounded-lg pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <IconInput
                  icon={Mail}
                  iconSize={14}
                  type="email"
                  value={billToEmail}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBillToEmail(e.target.value)}
                  placeholder="Invoice recipient email"
                  required
                  className="bg-[#111] border border-white/10 rounded-lg pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
                />
                <IconInput
                  icon={AtSign}
                  iconSize={14}
                  type="text"
                  value={ccEmails}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCcEmails(e.target.value)}
                  placeholder="CC emails, comma-separated"
                  className="bg-[#111] border border-white/10 rounded-lg pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
                />
              </div>
            </div>

            {/* Line Items */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">
                Line Items
              </h3>
              <div className="space-y-1 bg-[#111] rounded-lg border border-white/10 divide-y divide-white/5">
                {cityItems.map((item, index) => (
                  <div
                    key={item.event.id}
                    className={`flex items-center gap-3 px-3 py-2 ${
                      !item.included ? 'opacity-40' : ''
                    }`}
                  >
                    <Checkbox
                      checked={item.included}
                      onChange={() => toggleCity(index)}
                      label=""
                      size={16}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-white truncate">
                        {item.event.city}
                      </span>
                    </div>
                    <div className="text-xs text-white/40 w-20 text-right">
                      {item.event.expectedGuests ?? item.event.guestCount} guests
                    </div>
                    <div className="relative w-24">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
                      <input
                        type="number"
                        value={item.amount || ''}
                        onChange={(e) => updateAmount(index, e.target.value)}
                        disabled={!item.included}
                        className="w-full pl-5 pr-2 py-1 text-sm text-right bg-black/30 border border-white/10 rounded text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 disabled:opacity-50"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Total */}
              <div className="flex justify-end pt-2">
                <div className="flex items-center gap-2 text-lg font-bold">
                  <span className="text-white/60">Total:</span>
                  <span className="text-white font-mono">
                    ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Section */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">Payment</h3>
              <IconInput
                icon={DollarSign}
                iconSize={14}
                type="text"
                value={paymentInstructions}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPaymentInstructions(e.target.value)}
                placeholder="Payment instructions (e.g. 3,150 USDC to dreadpizzaroberts.eth)"
                className="bg-[#111] border border-white/10 rounded-lg pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className="bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-white/20"
                >
                  <option value="Due on receipt">Due on receipt</option>
                  <option value="Net 15">Net 15</option>
                  <option value="Net 30">Net 30</option>
                  <option value="Net 60">Net 60</option>
                </select>
                <IconInput
                  icon={Calendar}
                  iconSize={14}
                  type="date"
                  value={dueDate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDueDate(e.target.value)}
                  placeholder="Due date"
                  className="bg-[#111] border border-white/10 rounded-lg pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
                />
              </div>
              <IconInput
                icon={MessageSquare}
                iconSize={14}
                multiline
                rows={2}
                value={memo}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMemo(e.target.value)}
                placeholder="Notes for the partner (e.g. Thanks for sponsoring GPP 2026!)"
                className="bg-[#111] border border-white/10 rounded-lg pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2 border-t border-white/10">
              <button
                onClick={() => handleSave(false)}
                disabled={saving}
                className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Draft'}
              </button>
              <button
                onClick={() => handleSave(true)}
                disabled={saving}
                className="px-4 py-2 text-sm bg-[#ff393a] hover:bg-[#e02020] rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {saving ? 'Sending...' : 'Send Invoice'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
