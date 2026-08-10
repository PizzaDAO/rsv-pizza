import React, { useState } from 'react';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import type { StripeElementsOptions } from '@stripe/stripe-js';
import { getStripe, formatCurrency } from '../lib/stripe';
import { Loader2, CreditCard, Check, Lock, AlertCircle } from 'lucide-react';

interface PaymentFormProps {
  clientSecret: string;
  amount: number; // in cents, for display
  onPaymentSuccess: (paymentIntentId: string) => void;
  onCancel?: () => void;
}

// Inner form component that uses Stripe hooks
const PaymentFormInner: React.FC<{
  amount: number;
  onPaymentSuccess: (paymentIntentId: string) => void;
  onCancel?: () => void;
}> = ({
  amount,
  onPaymentSuccess,
  onCancel,
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Confirm the payment using PaymentElement (supports cards, crypto, etc.)
      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: 'if_required',
      });

      if (confirmError) {
        setError(confirmError.message || 'Payment failed');
        setLoading(false);
        return;
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        setSuccess(true);
        setTimeout(() => {
          onPaymentSuccess(paymentIntent.id);
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-[#39d98a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#39d98a]/30">
          <Check size={32} className="text-[#39d98a]" />
        </div>
        <h3 className="text-lg font-medium text-theme-text mb-2">Payment Successful!</h3>
        <p className="text-theme-text-secondary text-sm">Your payment has been securely processed.</p>
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

      <p className="text-xs text-theme-text-muted flex items-center gap-1">
        <Lock size={12} />
        Your payment is securely processed by Stripe.
      </p>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-[#ff393a]/10 border border-[#ff393a]/30 rounded-xl text-[#ff393a] text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="flex gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 btn-secondary"
            disabled={loading}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!stripe || loading}
          className="flex-1 btn-primary flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <CreditCard size={18} />
              Pay {formatCurrency(amount)}
            </>
          )}
        </button>
      </div>
    </form>
  );
};

// Wrapper component that provides Stripe context with clientSecret
export const PaymentForm: React.FC<PaymentFormProps> = ({
  clientSecret,
  amount,
  onPaymentSuccess,
  onCancel,
}) => {
  const stripePromise = getStripe();

  if (!stripePromise) {
    return (
      <div className="text-center py-8">
        <p className="text-theme-text-secondary">
          Payment is not configured. Please set up Stripe to enable payments.
        </p>
      </div>
    );
  }

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
      <PaymentFormInner
        amount={amount}
        onPaymentSuccess={onPaymentSuccess}
        onCancel={onCancel}
      />
    </Elements>
  );
};
