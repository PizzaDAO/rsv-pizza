import React, { useState } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { Beer, Share2, Check } from 'lucide-react';

export const BeverageOrderSummary: React.FC = () => {
  const { beverageRecommendations, party, guests } = usePizza();
  const [isCopied, setIsCopied] = useState(false);

  const totalBeverages = beverageRecommendations.reduce((acc, rec) => acc + rec.quantity, 0);
  const respondedGuests = guests.length;
  const expectedGuests = party?.maxGuests || respondedGuests;

  const handleCopyOrder = () => {
    if (beverageRecommendations.length === 0) return;

    const orderText = beverageRecommendations
      .map(rec => `${rec.quantity}x ${rec.beverage.name}`)
      .join('\n');

    const fullText = `BEVERAGE ORDER\n\nExpected guests: ${expectedGuests}\nTotal beverages: ${totalBeverages}\n\n${orderText}`;

    navigator.clipboard.writeText(fullText)
      .then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      })
      .catch(err => console.error('Failed to copy:', err));
  };

  if (beverageRecommendations.length === 0) {
    return (
      <div className="card p-6">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Beer size={20} className="text-[#ff393a]" />
          Beverage Order
        </h2>
        <div className="flex flex-col items-center justify-center min-h-[200px] text-center p-6 bg-white/5 rounded-xl border border-dashed border-white/20">
          <Beer size={48} className="text-white/30 mb-4" />
          <h3 className="text-lg font-medium text-white/80">No Beverages Selected</h3>
          <p className="text-white/50 mt-2 text-sm">
            Configure beverage selection and generate recommendations to see your order.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <Beer size={20} className="text-[#ff393a]" />
        Beverage Order
      </h2>

      <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
        <h3 className="font-medium text-blue-400 mb-2">Order Summary</h3>
        <div className="space-y-1 text-sm">
          <p className="text-white/80">
            <span className="text-white/60">Expected guests:</span>{' '}
            <span className="font-semibold text-white">{expectedGuests}</span>
          </p>
          <p className="text-white/80">
            <span className="text-white/60">Responded:</span>{' '}
            <span className="font-semibold text-white">{respondedGuests}</span>
          </p>
          <p className="text-white/80 pt-1 border-t border-white/10 mt-2">
            <span className="text-white/60">Total beverages:</span>{' '}
            <span className="font-semibold text-white text-base">{totalBeverages}</span>
          </p>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        {beverageRecommendations.map(rec => (
          <div
            key={rec.id}
            className="p-3 bg-white/5 border border-white/10 rounded-lg"
          >
            <div className="flex justify-between items-center">
              <div>
                <span className="font-semibold text-white">{rec.beverage.name}</span>
                <span className="text-white/50 text-sm ml-2">
                  ({rec.guestCount} {rec.guestCount === 1 ? 'guest' : 'guests'})
                </span>
              </div>
              <span className="text-[#ff393a] font-bold text-lg">
                {rec.quantity}x
              </span>
            </div>
            {rec.isForNonRespondents && (
              <p className="text-xs text-white/40 mt-1">For non-respondents</p>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={handleCopyOrder}
        disabled={beverageRecommendations.length === 0}
        className={`w-full flex items-center justify-center gap-2 py-2 rounded-xl font-medium text-sm transition-all ${
          isCopied
            ? 'bg-[#39d98a] text-white'
            : 'btn-secondary'
        }`}
      >
        {isCopied ? (
          <>
            <Check size={16} />
            <span>Copied!</span>
          </>
        ) : (
          <>
            <Share2 size={16} />
            <span>Copy Beverage Order</span>
          </>
        )}
      </button>
    </div>
  );
};
