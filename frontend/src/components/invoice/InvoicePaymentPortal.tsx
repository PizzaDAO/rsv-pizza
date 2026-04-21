import React, { useState } from 'react';
import { CreditCard, Building2 } from 'lucide-react';
import { Invoice } from '../../types';
import { InvoiceStripePayment } from './InvoiceStripePayment';
import { InvoiceCryptoPayment } from './InvoiceCryptoPayment';
import { InvoiceWireDetails } from './InvoiceWireDetails';

type PaymentTab = 'card' | 'crypto' | 'wire';

interface InvoicePaymentPortalProps {
  invoice: Invoice;
  onPaymentSuccess: (updatedInvoice: Invoice) => void;
}

// Check if Stripe is available
const hasStripe = !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

export const InvoicePaymentPortal: React.FC<InvoicePaymentPortalProps> = ({
  invoice,
  onPaymentSuccess,
}) => {
  // Determine which tabs are available
  const hasWire = !!invoice.paymentInstructions;
  const availableTabs: PaymentTab[] = [];
  if (hasStripe) availableTabs.push('card');
  availableTabs.push('crypto');
  if (hasWire) availableTabs.push('wire');

  const [activeTab, setActiveTab] = useState<PaymentTab>(availableTabs[0] || 'crypto');

  const formatAmount = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (invoice.currency || 'usd').toUpperCase(),
      minimumFractionDigits: 2,
    }).format(cents / 100);
  };

  // Only show portal for payable invoices
  if (!['issued', 'viewed'].includes(invoice.status)) {
    return null;
  }

  const tabConfig: Record<PaymentTab, { label: string; icon: React.ReactNode }> = {
    card: {
      label: 'Card',
      icon: <CreditCard size={18} />,
    },
    crypto: {
      label: 'Crypto',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1.5L5.5 12.5L12 16.5L18.5 12.5L12 1.5Z" />
          <path d="M5.5 12.5L12 22.5L18.5 12.5L12 16.5L5.5 12.5Z" />
        </svg>
      ),
    },
    wire: {
      label: 'Wire',
      icon: <Building2 size={18} />,
    },
  };

  return (
    <div className="bg-[#1a1a2e] rounded-xl p-6 text-white print:hidden">
      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold mb-1">Pay This Invoice</h2>
        <p className="text-white/60 text-lg">{formatAmount(invoice.total)}</p>
      </div>

      {/* Tab selector */}
      <div className="flex gap-2 mb-6">
        {availableTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium transition-all ${
              activeTab === tab
                ? 'bg-white/10 text-white border border-white/20'
                : 'bg-transparent text-white/40 border border-white/5 hover:bg-white/5 hover:text-white/60'
            }`}
          >
            {tabConfig[tab].icon}
            <span className="hidden sm:inline">{tabConfig[tab].label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'card' && (
          <InvoiceStripePayment
            invoice={invoice}
            onSuccess={onPaymentSuccess}
          />
        )}
        {activeTab === 'crypto' && (
          <InvoiceCryptoPayment
            invoice={invoice}
            onSuccess={onPaymentSuccess}
          />
        )}
        {activeTab === 'wire' && (
          <InvoiceWireDetails
            paymentInstructions={invoice.paymentInstructions}
          />
        )}
      </div>
    </div>
  );
};
