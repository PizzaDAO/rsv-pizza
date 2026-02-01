import React, { useState, useEffect } from 'react';
import { loadStripe, StripeElementsOptions } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { DollarSign, Loader2, Check, AlertCircle, User, Mail, MessageSquare, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { createDonation, updateDonationStatus } from '../lib/api';
import { DonationPublicStats } from '../types';
import { Checkbox } from './Checkbox';

// Initialize Stripe
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

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
      // Confirm the payment
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
      <div className="bg-white/5 rounded-xl p-4 border border-white/10">
        <PaymentElement
          options={{
            layout: 'tabs',
          }}
        />
      </div>

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

  // Amount selection step
  if (!clientSecret) {
    return (
      <div className="space-y-4">
        {/* Suggested Amounts */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            Select Amount
          </label>
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
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            Or Enter Custom Amount
          </label>
          <div className="relative">
            <DollarSign size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="number"
              min={0.5}
              step={0.01}
              value={customAmount}
              onChange={(e) => handleCustomAmountChange(e.target.value)}
              placeholder="0.00"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 pl-10 text-white text-lg focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            />
          </div>
        </div>

        {/* Donor Info */}
        <div className="space-y-3 border-t border-white/10 pt-4">
          <div className="relative">
            <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={donorName}
              onChange={(e) => setDonorName(e.target.value)}
              placeholder="Your Name (optional)"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 pl-10 text-white focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            />
          </div>

          <div className="relative">
            <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="email"
              value={donorEmail}
              onChange={(e) => setDonorEmail(e.target.value)}
              placeholder="Email (for receipt)"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 pl-10 text-white focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            />
          </div>

          <div className="relative">
            <MessageSquare size={18} className="absolute left-3 top-3 text-white/40" />
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a message (optional)"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 pl-10 text-white focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] min-h-[60px] resize-none"
            />
          </div>

          <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
            <Checkbox
              checked={isAnonymous}
              onChange={() => setIsAnonymous(!isAnonymous)}
              label=""
            />
            <div className="flex items-center gap-2 text-white/80">
              <EyeOff size={16} />
              Make my donation anonymous
            </div>
          </div>
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
      />
    </Elements>
  );
};
