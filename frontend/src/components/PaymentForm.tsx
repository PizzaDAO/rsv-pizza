import React, { useState, useEffect } from 'react';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import {
  getStripe,
  createStripeCustomer,
  getSetupIntent,
  getStoredCustomerId,
  storeCustomerId,
  storeCustomerEmail,
  setHasPaymentMethod,
} from '../lib/stripe';
import { Loader2, CreditCard, Check, Lock } from 'lucide-react';

interface PaymentFormProps {
  customerEmail: string;
  customerName: string;
  onPaymentMethodSaved: () => void;
  onCancel?: () => void;
}

// Inner form component that uses Stripe hooks
const PaymentFormInner: React.FC<PaymentFormProps> = ({
  customerEmail,
  customerName,
  onPaymentMethodSaved,
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
      // Get or create customer
      let customerId = getStoredCustomerId();

      if (!customerId) {
        const { customerId: newCustomerId } = await createStripeCustomer(
          customerEmail,
          customerName
        );
        customerId = newCustomerId;
        storeCustomerId(customerId);
      }

      storeCustomerEmail(customerEmail);

      // Get a SetupIntent
      const { clientSecret } = await getSetupIntent(customerId);

      // Confirm the SetupIntent with the card
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        throw new Error('Card element not found');
      }

      const { error: stripeError, setupIntent } = await stripe.confirmCardSetup(
        clientSecret,
        {
          payment_method: {
            card: cardElement,
            billing_details: {
              name: customerName,
              email: customerEmail,
            },
          },
        }
      );

      if (stripeError) {
        throw new Error(stripeError.message);
      }

      if (setupIntent?.status === 'succeeded') {
        setHasPaymentMethod(true);
        setSuccess(true);
        setTimeout(() => {
          onPaymentMethodSaved();
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save payment method');
    } finally {
      setLoading(false);
    }
  };

  const cardElementOptions = {
    style: {
      base: {
        fontSize: '16px',
        color: '#ffffff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        '::placeholder': {
          color: 'rgba(255, 255, 255, 0.5)',
        },
      },
      invalid: {
        color: '#ff393a',
        iconColor: '#ff393a',
      },
    },
  };

  if (success) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-[#39d98a]/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <Check size={32} className="text-[#39d98a]" />
        </div>
        <h3 className="text-lg font-medium text-white mb-2">Payment Method Saved!</h3>
        <p className="text-white/60 text-sm">Your card is securely stored for future orders.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">
          <CreditCard size={14} className="inline mr-1" />
          Card Information
        </label>
        <div className="p-4 bg-white/5 rounded-xl border border-white/20 focus-within:border-[#ff393a]/50 transition-colors">
          <CardElement options={cardElementOptions} />
        </div>
        <p className="mt-2 text-xs text-white/40 flex items-center gap-1">
          <Lock size={12} />
          Your card is securely stored by Stripe. We never see your full card number.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-[#ff393a]/10 border border-[#ff393a]/30 rounded-xl text-[#ff393a] text-sm">
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
              Saving...
            </>
          ) : (
            <>
              <CreditCard size={18} />
              Save Payment Method
            </>
          )}
        </button>
      </div>
    </form>
  );
};

// Wrapper component that provides Stripe context
export const PaymentForm: React.FC<PaymentFormProps> = (props) => {
  const [stripeReady, setStripeReady] = useState(false);
  const stripePromise = getStripe();

  useEffect(() => {
    if (stripePromise) {
      stripePromise.then((stripe) => {
        if (stripe) {
          setStripeReady(true);
        }
      });
    }
  }, [stripePromise]);

  if (!stripePromise) {
    return (
      <div className="text-center py-8">
        <p className="text-white/60">
          Payment is not configured. Please set up Stripe to enable payments.
        </p>
      </div>
    );
  }

  if (!stripeReady) {
    return (
      <div className="text-center py-8">
        <Loader2 size={24} className="animate-spin mx-auto text-white/50" />
        <p className="text-white/60 mt-2">Loading payment form...</p>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise}>
      <PaymentFormInner {...props} />
    </Elements>
  );
};
