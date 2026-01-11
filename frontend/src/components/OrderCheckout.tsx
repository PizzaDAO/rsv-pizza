import React, { useState } from 'react';
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
} from 'lucide-react';

interface OrderCheckoutProps {
  pizzeria: Pizzeria;
  orderingOption: OrderingOption;
  recommendations: PizzaRecommendation[];
  onClose: () => void;
  onOrderComplete: (orderId: string, checkoutUrl?: string) => void;
}

export const OrderCheckout: React.FC<OrderCheckoutProps> = ({
  pizzeria,
  orderingOption,
  recommendations,
  onClose,
  onOrderComplete,
}) => {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Convert recommendations to order items
  const orderItems: OrderItem[] = recommendations.map((pizza) => ({
    name: pizza.label || `${pizza.toppings.map(t => t.name).join(', ')} Pizza`,
    description: pizza.toppings.map(t => t.name).join(', '),
    quantity: pizza.quantity || 1,
    size: `${pizza.size.diameter}" ${pizza.size.name}`,
    toppings: pizza.toppings.map(t => t.name),
    dietaryNotes: pizza.dietaryRestrictions,
  }));

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

  // Handle AI phone order
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

    setLoading(true);
    setError(null);

    try {
      const result = await createAIPhoneOrder(
        pizzeria.name,
        pizzeria.phone,
        orderItems,
        customerName,
        customerPhone,
        fulfillmentType.toLowerCase() as 'pickup' | 'delivery',
        deliveryAddress || undefined
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

  const isAIPhoneOrder = orderingOption.provider === 'ai_phone';
  const isDirectOrder = supportsDirectOrdering(orderingOption.provider) && !isAIPhoneOrder;
  const isPhoneOrder = orderingOption.provider === 'phone';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
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
              <span className="text-white font-medium">
                {orderItems.reduce((sum, item) => sum + item.quantity, 0)}
              </span>
            </div>
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
              className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                fulfillmentType === 'PICKUP'
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
              className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                fulfillmentType === 'DELIVERY'
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
        <div className="space-y-4 mb-6">
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
              Phone Number
            </label>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full"
            />
          </div>

          {isDirectOrder && (
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                <Mail size={14} className="inline mr-1" />
                Email
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
              style={{ backgroundColor: getProviderColor(orderingOption.provider) }}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  AI is Calling...
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
                className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium transition-all ${
                  copied
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

          {!isDirectOrder && !isPhoneOrder && orderingOption.deepLink && (
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
