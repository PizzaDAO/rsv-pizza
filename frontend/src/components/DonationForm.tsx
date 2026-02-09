import React, { useState } from 'react';
import { loadStripe, StripeElementsOptions } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { DollarSign, Loader2, Check, AlertCircle, User, Mail, MessageSquare, CreditCard } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { createDonation } from '../lib/api';
import { DonationPublicStats } from '../types';
import { Checkbox } from './Checkbox';
import { IconInput } from './IconInput';
import { CryptoDonationWidget } from './CryptoDonationWidget';

// Initialize Stripe (lazy-load only when key exists to avoid empty key error)
const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;

// Default crypto donation address (fallback if host hasn't set one)
const DEFAULT_CRYPTO_ADDRESS = 'dreadpizzaroberts.eth';

interface DonationFormProps {
  partyId: string;
  stats: DonationPublicStats;
  onSuccess?: () => void;
  onCancel?: () => void;
  guestId?: string;
  guestName?: string;
  guestEmail?: string;
}

interface DonationFormInnerProps {
  partyId: string;
  amount: number;
  donorName: string;
  donorEmail: string;
  message: string;
  isAnonymous: boolean;
  onSuccess?: () => void;
  guestId?: string;
  clientSecret: string;
}

// The inner form component that uses Stripe hooks
const DonationFormInner: React.FC<DonationFormInnerProps> = ({
  partyId,
  amount,
  donorName,
  donorEmail,
  message,
  isAnonymous,
  onSuccess,
  guestId,
  clientSecret,
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      // Confirm the payment using PaymentElement (supports cards, Klarna, etc.)
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
        // Create donation record in our database
        await createDonation(partyId, {
          amount: amount / 100, // Convert from cents to dollars for storage
          currency: 'usd',
          paymentIntentId: paymentIntent.id,
          donorName: isAnonymous ? undefined : donorName,
          donorEmail,
          isAnonymous,
          message: message || undefined,
          guestId,
        });

        setSucceeded(true);
        onSuccess?.();
      }
    } catch (err) {
      console.error('Payment error:', err);
      setError('An unexpected error occurred');
    }

    setProcessing(false);
  };

  if (succeeded) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-[#39d98a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#39d98a]/30">
          <Check className="w-8 h-8 text-[#39d98a]" />
        </div>
        <h3 className="text-xl font-bold text-white mb-2">Thank You!</h3>
        <p className="text-white/60">Your donation of ${(amount / 100).toFixed(2)} has been received.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: 'accordion',
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
        className="w-full btn-primary flex items-center justify-center gap-2"
      >
        {processing ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <DollarSign size={18} />
            Donate ${(amount / 100).toFixed(2)}
          </>
        )}
      </button>
    </form>
  );
};

// Payment method type
type PaymentMethod = 'stripe' | 'crypto' | null;

// Main donation form component
export const DonationForm: React.FC<DonationFormProps> = ({
  partyId,
  stats,
  onSuccess,
  onCancel,
  guestId,
  guestName = '',
  guestEmail = '',
}) => {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(null);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [donorName, setDonorName] = useState(guestName);
  const [donorEmail, setDonorEmail] = useState(guestEmail);
  const [message, setMessage] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestedAmounts = stats.suggestedAmounts || [500, 1000, 2500, 5000];
  const cryptoAddress = stats.donationEthAddress || DEFAULT_CRYPTO_ADDRESS;

  const finalAmount = selectedAmount || (customAmount ? Math.round(parseFloat(customAmount) * 100) : 0);

  const createPaymentIntent = async () => {
    if (!finalAmount || finalAmount < 50) {
      setError('Minimum donation is $0.50');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Call Supabase edge function to create payment intent
      const { data, error: fnError } = await supabase.functions.invoke('stripe-payment', {
        body: {
          action: 'create_donation_intent',
          amount: finalAmount,
          currency: 'usd',
          customerEmail: donorEmail || undefined,
          customerName: isAnonymous ? undefined : donorName || undefined,
          partyId,
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

  const handleAmountSelect = (amount: number) => {
    setSelectedAmount(amount);
    setCustomAmount('');
  };

  const handleCustomAmountChange = (value: string) => {
    setCustomAmount(value);
    setSelectedAmount(null);
  };

  const elementsOptions: StripeElementsOptions = {
    clientSecret: clientSecret || undefined,
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

  // Show crypto donation view
  if (paymentMethod === 'crypto') {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setPaymentMethod(null)}
          className="text-white/60 hover:text-white text-sm flex items-center gap-1 transition-colors"
        >
          &larr; Back to payment options
        </button>
        <CryptoDonationWidget
          partyId={partyId}
          cryptoAddress={cryptoAddress}
          suggestedAmounts={suggestedAmounts}
          onSuccess={onSuccess}
          guestId={guestId}
          donorName={donorName}
          donorEmail={donorEmail}
          isAnonymous={isAnonymous}
          message={message}
        />
      </div>
    );
  }

  // Payment method selection (before amount selection)
  if (paymentMethod === null) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
            {/* Stripe option */}
            <button
              type="button"
              onClick={() => setPaymentMethod('stripe')}
              className="w-full p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all flex items-center gap-4"
            >
              <div className="w-12 h-12 bg-[#635bff]/20 rounded-full flex items-center justify-center border border-[#635bff]/30">
                <CreditCard size={24} className="text-[#635bff]" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-white font-medium">Pay with Card or Wallet</p>
                <p className="text-white/50 text-sm">Credit/debit card, Apple Pay, Google Pay & more</p>
              </div>
            </button>

            {/* Crypto option */}
            <button
              type="button"
              onClick={() => setPaymentMethod('crypto')}
              className="w-full p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all flex items-center gap-4"
            >
              <div className="w-12 h-12 bg-[#627eea]/20 rounded-full flex items-center justify-center border border-[#627eea]/30">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-[#627eea]">
                  <path d="M12 1.5L5.5 12.5L12 16.5L18.5 12.5L12 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M5.5 12.5L12 22.5L18.5 12.5L12 16.5L5.5 12.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="flex-1 text-left">
                <p className="text-white font-medium">Crypto</p>
                <p className="text-white/50 text-sm">ETH, USDC, or other tokens</p>
              </div>
            </button>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full btn-secondary"
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  // Amount selection step (for Stripe)
  if (!clientSecret && paymentMethod === 'stripe') {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setPaymentMethod(null)}
          className="text-white/60 hover:text-white text-sm flex items-center gap-1 transition-colors"
        >
          &larr; Back to payment options
        </button>

        {/* Suggested Amounts */}
        <div>
          <div className="grid grid-cols-2 gap-2">
            {suggestedAmounts.map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => handleAmountSelect(amount)}
                className={`p-3 rounded-xl border transition-all text-lg font-bold ${
                  selectedAmount === amount
                    ? 'bg-[#ff393a] border-[#ff393a] text-white'
                    : 'bg-white/5 border-white/10 text-white hover:bg-white/10'
                }`}
              >
                ${(amount / 100).toFixed(0)}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Amount */}
        <IconInput
          icon={DollarSign}
          type="number"
          min={0.5}
          step={0.01}
          value={customAmount}
          onChange={(e) => handleCustomAmountChange(e.target.value)}
          placeholder="Custom amount"
        />

        {/* Donor Info */}
        <div className="space-y-3 border-t border-white/10 pt-4">
          <IconInput
            icon={User}
            type="text"
            value={donorName}
            onChange={(e) => setDonorName(e.target.value)}
            placeholder="Your name"
          />

          <IconInput
            icon={Mail}
            type="email"
            value={donorEmail}
            onChange={(e) => setDonorEmail(e.target.value)}
            placeholder="Email (for receipt)"
          />

          <IconInput
            icon={MessageSquare}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Add a message"
            multiline
          />

          <Checkbox
            checked={isAnonymous}
            onChange={() => setIsAnonymous(!isAnonymous)}
            label="Make my donation anonymous"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-[#ff393a]/10 border border-[#ff393a]/30 rounded-xl text-[#ff393a] text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 btn-secondary"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={createPaymentIntent}
            disabled={!finalAmount || finalAmount < 50 || loading}
            className="flex-1 btn-primary flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Loading...
              </>
            ) : (
              <>
                Continue
                {finalAmount > 0 && ` - $${(finalAmount / 100).toFixed(2)}`}
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Payment form step
  return (
    <Elements stripe={stripePromise} options={elementsOptions}>
      <DonationFormInner
        partyId={partyId}
        amount={finalAmount}
        donorName={donorName}
        donorEmail={donorEmail}
        message={message}
        isAnonymous={isAnonymous}
        onSuccess={onSuccess}
        guestId={guestId}
        clientSecret={clientSecret!}
      />
    </Elements>
  );
};
