import React, { useState, useEffect } from 'react';
import { Pizzeria, OrderingOption, PizzaRecommendation, OrderItem } from '../types';
import {
  createSquareOrder,
  createAIPhoneOrder,
  generatePhoneOrderScript,
  getProviderName,
  getProviderColor,
  supportsDirectOrdering,
} from '../lib/ordering';
import {
  hasStoredPaymentMethod,
  estimateOrderTotal,
  formatCurrency,
  createVirtualCard,
  getVirtualCardDetails,
  createPaymentIntent,
  getStoredCustomerId,
  getStoredCustomerEmail,
} from '../lib/stripe';
import { PaymentForm } from './PaymentForm';
import {
  X,
  Loader2,
  Phone,
  Copy,
  Check,
  ExternalLink,
  MapPin,
  User,
  Mail,
  ShoppingCart,
  Truck,
  Store,
  Bot,
  CreditCard,
  DollarSign,
  ChevronRight,
} from 'lucide-react';

interface OrderCheckoutProps {
  pizzeria: Pizzeria;
  orderingOption: OrderingOption;
  recommendations: PizzaRecommendation[];
  onClose: () => void;
  onOrderComplete: (orderId: string, checkoutUrl?: string) => void;
}

type CheckoutStep = 'details' | 'payment' | 'confirm';

export const OrderCheckout: React.FC<OrderCheckoutProps> = ({
  pizzeria,
  orderingOption,
  recommendations,
  onClose,
  onOrderComplete,
}) => {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState(getStoredCustomerEmail() || '');
  const [fulfillmentType, setFulfillmentType] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Payment state
  const [step, setStep] = useState<CheckoutStep>('details');
  const [hasPaymentMethod, setHasPaymentMethod] = useState(hasStoredPaymentMethod());
  const [payWithCard, setPayWithCard] = useState(false);

  // Convert recommendations to order items
  const orderItems: OrderItem[] = recommendations.map((pizza) => ({
    name: pizza.label || `${pizza.toppings.map(t => t.name).join(', ')} Pizza`,
    description: pizza.toppings.map(t => t.name).join(', '),
    quantity: pizza.quantity || 1,
    size: `${pizza.size.diameter}" ${pizza.size.name}`,
    toppings: pizza.toppings.map(t => t.name),
    dietaryNotes: pizza.dietaryRestrictions,
  }));

  const totalPizzas = orderItems.reduce((sum, item) => sum + item.quantity, 0);
  const estimatedTotal = estimateOrderTotal(totalPizzas);

  const isAIPhoneOrder = orderingOption.provider === 'ai_phone';
  const isDirectOrder = supportsDirectOrdering(orderingOption.provider) && !isAIPhoneOrder;
  const isPhoneOrder = orderingOption.provider === 'phone';

  // Handle direct API order (Square, etc.)
  const handleDirectOrder = async () => {
    if (!customerName.trim()) {
      setError('Please enter your name');
      return;
    }

    if (fulfillmentType === 'DELIVERY' && !deliveryAddress.trim()) {
      setError('Please enter a delivery address');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await createSquareOrder(
        orderingOption.merchantId!,
        orderItems,
        customerName,
        customerPhone || undefined,
        customerEmail || undefined,
        fulfillmentType,
        deliveryAddress || undefined
      );

      if (result.success && result.orderId) {
        onOrderComplete(result.orderId, result.checkoutUrl);
      } else {
        setError(result.error || 'Failed to create order');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create order');
    } finally {
      setLoading(false);
    }
  };

  // Handle AI phone order with payment
  const handleAIPhoneOrder = async () => {
    if (!customerName.trim()) {
      setError('Please enter your name');
      return;
    }

    if (!customerPhone.trim()) {
      setError('Please enter your phone number so the pizzeria can reach you');
      return;
    }

    if (fulfillmentType === 'DELIVERY' && !deliveryAddress.trim()) {
      setError('Please enter a delivery address');
      return;
    }

    if (!pizzeria.phone) {
      setError('This pizzeria does not have a phone number on file');
      return;
    }

    // If paying with card but no payment method, go to payment step
    if (payWithCard && !hasPaymentMethod) {
      setStep('payment');
      return;
    }

    // If paying with card, go to confirm step
    if (payWithCard && step === 'details') {
      setStep('confirm');
      return;
    }

    setLoading(true);
    setError(null);

    const partySize = recommendations.reduce((sum, pizza) => sum + pizza.guestCount, 0);

    try {
      let virtualCardDetails = undefined;

      // If paying with card, create virtual card
      if (payWithCard && hasPaymentMethod) {
        const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create pre-authorization on customer's card
        const customerId = getStoredCustomerId();
        if (customerId) {
          await createPaymentIntent(
            estimatedTotal,
            customerId,
            customerEmail,
            {
              orderId,
              pizzeriaName: pizzeria.name,
              pizzeriaPhone: pizzeria.phone,
            }
          );
        }

        // Create virtual card for this order
        const card = await createVirtualCard(
          estimatedTotal,
          orderId,
          pizzeria.name
        );

        // Get full card details for AI
        virtualCardDetails = await getVirtualCardDetails(card.cardId);
      }

      const result = await createAIPhoneOrder(
        pizzeria.name,
        pizzeria.phone,
        orderItems,
        customerName,
        customerPhone,
        fulfillmentType.toLowerCase() as 'pickup' | 'delivery',
        deliveryAddress || undefined,
        partySize,
        virtualCardDetails
      );

      if (result.success && result.callId) {
        onOrderComplete(result.callId, undefined);
      } else {
        setError(result.error || 'Failed to initiate AI call');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate AI call');
    } finally {
      setLoading(false);
    }
  };

  // Handle manual phone order
  const handlePhoneOrder = () => {
    const script = generatePhoneOrderScript(
      pizzeria.name,
      orderItems,
      customerName || 'Customer',
      fulfillmentType.toLowerCase() as 'pickup' | 'delivery',
      deliveryAddress
    );

    navigator.clipboard.writeText(script).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  };

  // Handle payment method saved
  const handlePaymentMethodSaved = () => {
    setHasPaymentMethod(true);
    setStep('confirm');
  };

  // Render payment step
  if (step === 'payment') {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-white">Add Payment Method</h2>
              <p className="text-sm text-white/60 mt-1">
                Your card will be charged after the order is confirmed
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white/50 hover:text-white p-1"
            >
              <X size={24} />
            </button>
          </div>

          <PaymentForm
            customerEmail={customerEmail}
            customerName={customerName}
            onPaymentMethodSaved={handlePaymentMethodSaved}
            onCancel={() => setStep('details')}
          />
        </div>
      </div>
    );
  }

  // Render confirmation step
  if (step === 'confirm') {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-white">Confirm Order</h2>
              <p className="text-sm text-white/60 mt-1">{pizzeria.name}</p>
            </div>
            <button
              onClick={onClose}
              className="text-white/50 hover:text-white p-1"
            >
              <X size={24} />
            </button>
          </div>

          {/* Order Summary */}
          <div className="mb-6 p-4 bg-white/5 rounded-xl border border-white/10">
            <h3 className="font-medium text-white mb-3">Order Summary</h3>
            <div className="space-y-2">
              {orderItems.map((item, index) => (
                <div key={index} className="flex justify-between text-sm">
                  <span className="text-white/80">
                    {item.quantity}x {item.size} {item.name}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-white/10 mt-3 pt-3">
              <div className="flex justify-between text-sm">
                <span className="text-white/60">Total pizzas:</span>
                <span className="text-white font-medium">{totalPizzas}</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-white/60">Estimated total:</span>
                <span className="text-white font-medium">{formatCurrency(estimatedTotal)}</span>
              </div>
            </div>
          </div>

          {/* Payment Method */}
          <div className="mb-6 p-4 bg-[#8b5cf6]/10 rounded-xl border border-[#8b5cf6]/30">
            <div className="flex items-center gap-3">
              <CreditCard size={20} className="text-[#8b5cf6]" />
              <div>
                <p className="text-white font-medium">Card on file</p>
                <p className="text-white/60 text-sm">
                  Your card will be pre-authorized for {formatCurrency(estimatedTotal)}
                </p>
              </div>
            </div>
          </div>

          {/* How it works */}
          <div className="mb-6 p-4 bg-white/5 rounded-xl border border-white/10">
            <h4 className="font-medium text-white mb-2">How it works</h4>
            <ol className="space-y-2 text-sm text-white/70">
              <li className="flex items-start gap-2">
                <span className="bg-[#ff393a] text-white w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0">1</span>
                <span>AI calls the pizzeria and places your order</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="bg-[#ff393a] text-white w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0">2</span>
                <span>AI pays with a secure virtual card</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="bg-[#ff393a] text-white w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0">3</span>
                <span>Your card is charged for the actual order total</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="bg-[#ff393a] text-white w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0">4</span>
                <span>Pick up your pizza (or wait for delivery)!</span>
              </li>
            </ol>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-[#ff393a]/10 border border-[#ff393a]/30 rounded-xl text-[#ff393a] text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="space-y-3">
            <button
              onClick={handleAIPhoneOrder}
              disabled={loading}
              className="w-full btn-primary flex items-center justify-center gap-2"
              style={{ backgroundColor: '#8b5cf6' }}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  AI is Calling...
                </>
              ) : (
                <>
                  <Bot size={18} />
                  Confirm & Place Order
                </>
              )}
            </button>

            <button
              onClick={() => setStep('details')}
              className="w-full btn-secondary"
              disabled={loading}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render details step (main form)
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">Complete Your Order</h2>
            <p className="text-sm text-white/60 mt-1">{pizzeria.name}</p>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white p-1"
          >
            <X size={24} />
          </button>
        </div>

        {/* Order Summary */}
        <div className="mb-6 p-4 bg-white/5 rounded-xl border border-white/10">
          <h3 className="font-medium text-white mb-3">Order Summary</h3>
          <div className="space-y-2">
            {orderItems.map((item, index) => (
              <div key={index} className="flex justify-between text-sm">
                <span className="text-white/80">
                  {item.quantity}x {item.size} {item.name}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-white/10 mt-3 pt-3">
            <div className="flex justify-between text-sm">
              <span className="text-white/60">Total pizzas:</span>
              <span className="text-white font-medium">{totalPizzas}</span>
            </div>
            {isAIPhoneOrder && (
              <div className="flex justify-between text-sm mt-1">
                <span className="text-white/60">Estimated total:</span>
                <span className="text-white font-medium">~{formatCurrency(estimatedTotal)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Fulfillment Type */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-white/80 mb-2">
            Fulfillment Type
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setFulfillmentType('PICKUP')}
              className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${fulfillmentType === 'PICKUP'
                  ? 'border-[#ff393a] bg-[#ff393a]/10 text-white'
                  : 'border-white/10 text-white/60 hover:border-white/20'
                }`}
            >
              <Store size={18} />
              Pickup
            </button>
            <button
              type="button"
              onClick={() => setFulfillmentType('DELIVERY')}
              className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${fulfillmentType === 'DELIVERY'
                  ? 'border-[#ff393a] bg-[#ff393a]/10 text-white'
                  : 'border-white/10 text-white/60 hover:border-white/20'
                }`}
            >
              <Truck size={18} />
              Delivery
            </button>
          </div>
        </div>

        {/* Customer Info */}
        <div className="space-y-3 mb-6">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              <User size={14} className="inline mr-1" />
              Your Name *
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="John Doe"
              className="w-full"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              <Phone size={14} className="inline mr-1" />
              Phone Number {isAIPhoneOrder && '*'}
            </label>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full"
            />
          </div>

          {(isDirectOrder || isAIPhoneOrder) && (
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                <Mail size={14} className="inline mr-1" />
                Email {isAIPhoneOrder && payWithCard && '*'}
              </label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full"
              />
            </div>
          )}

          {fulfillmentType === 'DELIVERY' && (
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                <MapPin size={14} className="inline mr-1" />
                Delivery Address *
              </label>
              <input
                type="text"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder="123 Main St, City, State ZIP"
                className="w-full"
                required
              />
            </div>
          )}
        </div>

        {/* Payment Option for AI Orders */}
        {isAIPhoneOrder && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-white/80 mb-2">
              <DollarSign size={14} className="inline mr-1" />
              Payment Method
            </label>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setPayWithCard(false)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${!payWithCard
                    ? 'border-[#ff393a] bg-[#ff393a]/10 text-white'
                    : 'border-white/10 text-white/60 hover:border-white/20'
                  }`}
              >
                <Store size={18} />
                <div className="text-left">
                  <p className="font-medium">Pay at pickup</p>
                  <p className="text-xs text-white/50">Pay when you collect your order</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setPayWithCard(true)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${payWithCard
                    ? 'border-[#8b5cf6] bg-[#8b5cf6]/10 text-white'
                    : 'border-white/10 text-white/60 hover:border-white/20'
                  }`}
              >
                <CreditCard size={18} />
                <div className="text-left flex-1">
                  <p className="font-medium">Pay with card</p>
                  <p className="text-xs text-white/50">AI pays over phone with secure virtual card</p>
                </div>
                {hasPaymentMethod && (
                  <Check size={16} className="text-[#39d98a]" />
                )}
              </button>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-[#ff393a]/10 border border-[#ff393a]/30 rounded-xl text-[#ff393a] text-sm">
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3">
          {isAIPhoneOrder && (
            <button
              onClick={handleAIPhoneOrder}
              disabled={loading}
              className="w-full btn-primary flex items-center justify-center gap-2"
              style={{ backgroundColor: payWithCard ? '#8b5cf6' : getProviderColor(orderingOption.provider) }}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  {payWithCard ? 'Processing...' : 'AI is Calling...'}
                </>
              ) : payWithCard ? (
                <>
                  <CreditCard size={18} />
                  Continue to Payment
                  <ChevronRight size={18} />
                </>
              ) : (
                <>
                  <Bot size={18} />
                  Have AI Call & Order
                </>
              )}
            </button>
          )}

          {isDirectOrder && (
            <button
              onClick={handleDirectOrder}
              disabled={loading}
              className="w-full btn-primary flex items-center justify-center gap-2"
              style={{ backgroundColor: getProviderColor(orderingOption.provider) }}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Creating Order...
                </>
              ) : (
                <>
                  <ShoppingCart size={18} />
                  Place Order with {getProviderName(orderingOption.provider)}
                </>
              )}
            </button>
          )}

          {isPhoneOrder && (
            <>
              <button
                onClick={handlePhoneOrder}
                className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium transition-all ${copied
                    ? 'bg-[#39d98a] text-white'
                    : 'btn-secondary'
                  }`}
              >
                {copied ? (
                  <>
                    <Check size={18} />
                    Order Script Copied!
                  </>
                ) : (
                  <>
                    <Copy size={18} />
                    Copy Order Script
                  </>
                )}
              </button>

              {pizzeria.phone && (
                <a
                  href={`tel:${pizzeria.phone}`}
                  className="w-full btn-primary flex items-center justify-center gap-2"
                >
                  <Phone size={18} />
                  Call {pizzeria.name}
                </a>
              )}
            </>
          )}

          {!isDirectOrder && !isPhoneOrder && !isAIPhoneOrder && orderingOption.deepLink && (
            <a
              href={orderingOption.deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
              <ExternalLink size={18} />
              Order on {getProviderName(orderingOption.provider)}
            </a>
          )}

          <button
            onClick={onClose}
            className="w-full btn-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
