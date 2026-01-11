import React, { useState } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { PizzaCard } from './PizzaCard';
import { PizzeriaSearch } from './PizzeriaSearch';
import { OrderCheckout } from './OrderCheckout';
import { Pizzeria, OrderingOption } from '../types';
import { ClipboardList, Share2, Check, ShoppingCart, X, ExternalLink } from 'lucide-react';

export const PizzaOrderSummary: React.FC = () => {
  const { recommendations, party, guests } = usePizza();
  const [isCopied, setIsCopied] = useState(false);
  const [showPizzeriaSearch, setShowPizzeriaSearch] = useState(false);
  const [selectedPizzeria, setSelectedPizzeria] = useState<Pizzeria | null>(null);
  const [selectedOption, setSelectedOption] = useState<OrderingOption | null>(null);
  const [orderComplete, setOrderComplete] = useState<{ orderId: string; checkoutUrl?: string } | null>(null);

  // Calculate totals
  const totalPizzas = recommendations.reduce((acc, pizza) => acc + (pizza.quantity || 1), 0);
  const respondedGuests = guests.length;
  const expectedGuests = party?.maxGuests || respondedGuests;

  const handleCopyOrder = () => {
    if (recommendations.length === 0) return;

    const orderText = recommendations.map(pizza => {
      const qty = pizza.quantity || 1;
      const toppingsText = pizza.toppings.map(t => t.name).join(', ');
      const label = pizza.label || toppingsText;
      return `${qty}x ${label} (${pizza.size.diameter}" ${pizza.style.name}) - serves ${pizza.guestCount}`;
    }).join('\n');

    const fullText = `PIZZA PARTY ORDER\n\nExpected guests: ${expectedGuests}\nResponded: ${respondedGuests}\nTotal pizzas: ${totalPizzas}\n\n${orderText}`;

    navigator.clipboard.writeText(fullText)
      .then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      })
      .catch(err => console.error('Failed to copy order:', err));
  };

  const handleSelectPizzeria = (pizzeria: Pizzeria, option: OrderingOption) => {
    setSelectedPizzeria(pizzeria);
    setSelectedOption(option);
    setShowPizzeriaSearch(false);
  };

  const handleOrderComplete = (orderId: string, checkoutUrl?: string) => {
    setOrderComplete({ orderId, checkoutUrl });
    setSelectedPizzeria(null);
    setSelectedOption(null);
  };

  const handleCloseCheckout = () => {
    setSelectedPizzeria(null);
    setSelectedOption(null);
  };

  return (
    <>
      <div className="card p-6 sticky top-6">
        <h2 className="text-xl font-bold text-white mb-4">Recommended Order</h2>

        {recommendations.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[300px] text-center p-6 bg-white/5 rounded-xl border border-dashed border-white/20">
            <ClipboardList size={48} className="text-white/30 mb-4" />
            <h3 className="text-lg font-medium text-white/80">No Recommendations Yet</h3>
            <p className="text-white/50 mt-2 text-sm">
              Add guests and generate recommendations to see your optimized pizza order here.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 p-4 bg-[#ffb347]/10 border border-[#ffb347]/30 rounded-xl">
              <h3 className="font-medium text-[#ffb347] mb-2">Order Summary</h3>
              <div className="space-y-1 text-sm">
                <p className="text-white/80">
                  <span className="text-white/60">Expected guests:</span>{' '}
                  <span className="font-semibold text-white">{expectedGuests}</span>
                </p>
                <p className="text-white/80">
                  <span className="text-white/60">Responded:</span>{' '}
                  <span className="font-semibold text-white">{respondedGuests}</span>
                  {expectedGuests > respondedGuests && (
                    <span className="text-white/50"> ({expectedGuests - respondedGuests} pending)</span>
                  )}
                </p>
                <p className="text-white/80 pt-1 border-t border-white/10 mt-2">
                  <span className="text-white/60">Total pizzas:</span>{' '}
                  <span className="font-semibold text-white text-base">{totalPizzas}</span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5 mb-6">
              {[...recommendations]
                .sort((a, b) => (b.quantity || 1) - (a.quantity || 1))
                .map((pizza, index) => (
                <PizzaCard key={pizza.id} pizza={pizza} index={index} compact />
              ))}
            </div>

            {/* Order buttons */}
            <div className="space-y-3">
              <button
                onClick={() => setShowPizzeriaSearch(true)}
                className="w-full btn-primary flex items-center justify-center gap-2"
              >
                <ShoppingCart size={18} />
                Order Now
              </button>

              <button
                onClick={handleCopyOrder}
                disabled={recommendations.length === 0}
                className={`w-full flex items-center justify-center space-x-2 py-3 rounded-xl font-medium transition-all ${
                  isCopied
                    ? 'bg-[#39d98a] text-white'
                    : 'btn-secondary'
                }`}
              >
                {isCopied ? (
                  <>
                    <Check size={18} />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Share2 size={18} />
                    <span>Copy Order</span>
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Pizzeria Search Modal */}
      {showPizzeriaSearch && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setShowPizzeriaSearch(false)}
                className="p-2 text-white/50 hover:text-white bg-white/10 rounded-full"
              >
                <X size={20} />
              </button>
            </div>
            <PizzeriaSearch onSelectPizzeria={handleSelectPizzeria} partyAddress={party?.address} />
          </div>
        </div>
      )}

      {/* Order Checkout Modal */}
      {selectedPizzeria && selectedOption && (
        <OrderCheckout
          pizzeria={selectedPizzeria}
          orderingOption={selectedOption}
          recommendations={recommendations}
          onClose={handleCloseCheckout}
          onOrderComplete={handleOrderComplete}
        />
      )}

      {/* Order Complete Modal */}
      {orderComplete && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-md text-center">
            <div className="w-16 h-16 rounded-full bg-[#39d98a]/20 flex items-center justify-center mx-auto mb-4">
              <Check size={32} className="text-[#39d98a]" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Order Created!</h2>
            <p className="text-white/60 mb-6">
              Your order has been submitted successfully.
            </p>

            {orderComplete.checkoutUrl ? (
              <a
                href={orderComplete.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full btn-primary flex items-center justify-center gap-2 mb-3"
              >
                <ExternalLink size={18} />
                Complete Payment
              </a>
            ) : (
              <p className="text-sm text-white/50 mb-4">
                Order ID: {orderComplete.orderId}
              </p>
            )}

            <button
              onClick={() => setOrderComplete(null)}
              className="w-full btn-secondary"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
};
