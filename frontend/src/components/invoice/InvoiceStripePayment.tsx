import React, { useState } from 'react';
import { loadStripe, StripeElementsOptions } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2, Check, AlertCircle, CreditCard } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { payInvoice } from '../../lib/api';
import { Invoice } from '../../types';

// Initialize Stripe (lazy-load only when key exists)
const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;

interface InvoiceStripePaymentProps {
  invoice: Invoice;
  onSuccess: (updatedInvoice: Invoice) => void;
}

// Inner form component that uses Stripe hooks (must be inside <Elements>)
const StripePaymentForm: React.FC<{
  invoice: Invoice;
  onSuccess: (updatedInvoice: Invoice) => void;
  onBack: () => void;
}> = ({ invoice, onSuccess, onBack }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const formatAmount = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (invoice.currency || 'usd').toUpperCase(),
      minimumFractionDigits: 2,
    }).format(cents / 100);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) return;

    setProcessing(true);
    setError(null);

    try {
      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: 'if_required',
      });

      if (confirmError) {
        setError(confirmError.message || 'Payment failed');
        setProcessing(false);
        return;
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        // Record payment on the backend
        const result = await payInvoice(invoice.viewToken, {
          paymentMethod: 'stripe',
          paymentRef: paymentIntent.id,
          paidAmount: invoice.total,
        });

        setSucceeded(true);
        if (result?.invoice) {
          onSuccess(result.invoice);
        }
      }
    } catch (err) {
      console.error('Payment error:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    }

    setProcessing(false);
  };

  if (succeeded) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-[#39d98a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#39d98a]/30">
          <Check className="w-8 h-8 text-[#39d98a]" />
        </div>
        <h3 className="text-xl font-bold text-white mb-2">Payment Received</h3>
        <p className="text-white/60">
          Your payment of {formatAmount(invoice.total)} has been processed successfully.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: {
            type: 'accordion',
            defaultCollapsed: false,
          },
          paymentMethodOrder: ['card'],
        }}
      />

      {error && (
        <div className="flex items-center gap-2 p-3 bg-[#ff393a]/10 border border-[#ff393a]/30 rounded-xl text-[#ff393a] text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full bg-[#ff393a] hover:bg-[#ff393a]/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {processing ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <CreditCard size={18} />
            Pay {formatAmount(invoice.total)}
          </>
        )}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="w-full text-white/50 hover:text-white/70 text-sm py-2 transition-colors"
      >
        Back
      </button>
    </form>
  );
};

// Main component that handles PI creation and wraps with Elements
export const InvoiceStripePayment: React.FC<InvoiceStripePaymentProps> = ({
  invoice,
  onSuccess,
}) => {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatAmount = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (invoice.currency || 'usd').toUpperCase(),
      minimumFractionDigits: 2,
    }).format(cents / 100);
  };

  if (!stripePromise) {
    return (
      <div className="text-center py-6">
        <AlertCircle size={32} className="mx-auto text-white/30 mb-3" />
        <p className="text-white/50 text-sm">
          Card payments are not available at this time.
        </p>
      </div>
    );
  }

  const createPaymentIntent = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('stripe-payment', {
        body: {
          action: 'create_donation_intent',
          amount: invoice.total,
          currency: invoice.currency || 'usd',
          customerEmail: invoice.billToEmail || undefined,
          partyId: invoice.partyId,
          metadata: {
            type: 'invoice_payment',
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
          },
        },
      });

      if (fnError) {
        throw new Error(fnError.message);
      }

      if (data?.clientSecret) {
        setClientSecret(data.clientSecret);
      } else {
        throw new Error('Failed to create payment intent');
      }
    } catch (err) {
      console.error('Error creating payment intent:', err);
      setError('Failed to initialize payment. Please try again.');
    }

    setLoading(false);
  };

  // If we have a client secret, show the Stripe Elements form
  if (clientSecret) {
    const elementsOptions: StripeElementsOptions = {
      clientSecret,
      appearance: {
        theme: 'night',
        variables: {
          colorPrimary: '#ff393a',
          colorBackground: '#1a1a2e',
          colorText: '#ffffff',
          colorDanger: '#ff393a',
          fontFamily: 'system-ui, sans-serif',
          borderRadius: '12px',
        },
      },
    };

    return (
      <Elements stripe={stripePromise} options={elementsOptions}>
        <StripePaymentForm
          invoice={invoice}
          onSuccess={onSuccess}
          onBack={() => setClientSecret(null)}
        />
      </Elements>
    );
  }

  // Show "Pay with Card" button to start the flow
  return (
    <div className="space-y-4">
      <div className="text-center py-4">
        <p className="text-white/60 text-sm mb-4">
          Pay {formatAmount(invoice.total)} with credit card, Apple Pay, or Google Pay.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-[#ff393a]/10 border border-[#ff393a]/30 rounded-xl text-[#ff393a] text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={createPaymentIntent}
        disabled={loading}
        className="w-full bg-[#ff393a] hover:bg-[#ff393a]/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Initializing...
          </>
        ) : (
          <>
            <CreditCard size={18} />
            Pay {formatAmount(invoice.total)}
          </>
        )}
      </button>
    </div>
  );
};
