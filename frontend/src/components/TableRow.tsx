import React from 'react';
import { Guest, BeverageRecommendation, PizzaRecommendation } from '../types';
import { Trash2, Check, X, ArrowUpCircle } from 'lucide-react';
import { format } from 'date-fns';
import { getToppingEmoji } from '../utils/toppingEmojis';

// Generate a consistent color based on name
const getAvatarColor = (name: string) => {
  const colors = [
    'bg-red-400', 'bg-orange-400', 'bg-amber-400', 'bg-yellow-400',
    'bg-lime-400', 'bg-green-400', 'bg-emerald-400', 'bg-teal-400',
    'bg-cyan-400', 'bg-sky-400', 'bg-blue-400', 'bg-indigo-400',
    'bg-violet-400', 'bg-purple-400', 'bg-fuchsia-400', 'bg-pink-400',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

export type TableRowVariant = 'basic' | 'requests' | 'beverage' | 'pizza' | 'waitlist';

interface TableRowProps {
  guest?: Guest;
  beverageRec?: BeverageRecommendation;
  pizzaRec?: PizzaRecommendation;
  pizzaIndex?: number;
  variant?: TableRowVariant;
  requireApproval?: boolean;
  onApprove?: (id: string) => void;
  onDecline?: (id: string) => void;
  onRemove?: (id: string) => void;
  onPromote?: (id: string) => void;
  // For requests variant - lookup functions
  toppingNameById?: (id: string) => string;
  beverageNameById?: (id: string) => string;
}

export const TableRow: React.FC<TableRowProps> = ({
  guest,
  beverageRec,
  pizzaRec,
  pizzaIndex = 0,
  variant = 'basic',
  requireApproval = false,
  onApprove,
  onDecline,
  onRemove,
  onPromote,
  toppingNameById = (id) => id,
  beverageNameById = (id) => id,
}) => {
  // Pizza variant
  if (variant === 'pizza' && pizzaRec) {
    const quantity = pizzaRec.quantity || 1;
    const label = pizzaRec.label || pizzaRec.toppings.map(t => t.name).join(', ') || 'Cheese';
    const toppingEmojis = pizzaRec.toppings.map(t => getToppingEmoji(t.name)).join('') || '🧀';

    // Half-and-half display
    if (pizzaRec.isHalfAndHalf && pizzaRec.leftHalf && pizzaRec.rightHalf) {
      const leftLabel = pizzaRec.leftHalf.toppings.map(t => t.name).join(', ') || 'Cheese';
      const rightLabel = pizzaRec.rightHalf.toppings.map(t => t.name).join(', ') || 'Cheese';
      const combinedLabel = `½ ${leftLabel} / ½ ${rightLabel}`;

      return (
        <div className="flex items-center gap-3 py-3 group hover:bg-white/5 -mx-2 px-2 rounded-lg transition-colors">
          {/* Quantity */}
          <span className="text-[#ff393a] font-bold text-sm flex-shrink-0 w-8 text-center">
            {quantity}x
          </span>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-white">{combinedLabel}</span>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {pizzaRec.dietaryRestrictions.map(r => (
                <span key={r} className="px-1.5 py-0.5 bg-purple-500/20 text-purple-300 text-[10px] rounded border border-purple-500/30">
                  {r}
                </span>
              ))}
              <span className="text-white/50 text-xs">
                {pizzaRec.size.diameter}" {pizzaRec.style.name}
              </span>
            </div>
          </div>

          {/* Guest count */}
          <span className="text-white/50 text-xs flex-shrink-0">
            {pizzaRec.guestCount} {pizzaRec.guestCount === 1 ? 'guest' : 'guests'}
          </span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-3 py-3 group hover:bg-white/5 -mx-2 px-2 rounded-lg transition-colors">
        {/* Quantity */}
        <span className={`font-bold text-sm flex-shrink-0 w-8 text-center ${pizzaRec.isForNonRespondents ? 'text-[#6b7280]' : 'text-[#ff393a]'}`}>
          {quantity}x
        </span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white">{label}</span>
            <span className="text-base" title={pizzaRec.toppings.map(t => t.name).join(', ')}>
              {toppingEmojis}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {pizzaRec.dietaryRestrictions.map(r => (
              <span key={r} className="px-1.5 py-0.5 bg-purple-500/20 text-purple-300 text-[10px] rounded border border-purple-500/30">
                {r}
              </span>
            ))}
            <span className="text-white/50 text-xs">
              {pizzaRec.size.diameter}" {pizzaRec.style.name}
            </span>
            {pizzaRec.isForNonRespondents && (
              <span className="px-1.5 py-0.5 bg-white/10 text-white/60 text-[10px] rounded">
                For non-respondents
              </span>
            )}
          </div>
        </div>

        {/* Guest count */}
        <span className="text-white/50 text-xs flex-shrink-0">
          {pizzaRec.guestCount} {pizzaRec.guestCount === 1 ? 'guest' : 'guests'}
        </span>
      </div>
    );
  }

  // Beverage variant
  if (variant === 'beverage' && beverageRec) {
    return (
      <div className="flex items-center gap-3 py-3 group hover:bg-white/5 -mx-2 px-2 rounded-lg transition-colors">
        {/* Quantity */}
        <span className={`font-bold text-sm flex-shrink-0 w-8 text-center ${beverageRec.isForNonRespondents ? 'text-[#6b7280]' : 'text-blue-500'}`}>
          {beverageRec.quantity}x
        </span>

        {/* Content */}
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-white">{beverageRec.beverage.name}</span>
          <span className="text-white/50 text-xs">
            ({beverageRec.guestCount} {beverageRec.guestCount === 1 ? 'guest' : 'guests'})
          </span>
          {beverageRec.isForNonRespondents && (
            <span className="px-1.5 py-0.5 bg-white/10 text-white/60 text-[10px] rounded">
              For non-respondents
            </span>
          )}
        </div>
      </div>
    );
  }

  // Guest variants require guest
  if (!guest) return null;

  // Waitlist variant
  if (variant === 'waitlist') {
    return (
      <div className="flex items-center gap-3 py-3 group hover:bg-white/5 -mx-2 px-2 rounded-lg transition-colors">
        {/* Position badge */}
        <div className="w-8 h-8 rounded-full bg-[#ffc107]/20 border border-[#ffc107]/30 flex items-center justify-center text-[#ffc107] text-sm font-bold flex-shrink-0">
          #{guest.waitlistPosition || '?'}
        </div>

        {/* Avatar */}
        <div className={`w-8 h-8 rounded-full ${getAvatarColor(guest.name)} flex items-center justify-center text-white text-sm font-medium flex-shrink-0`}>
          {guest.name.charAt(0).toUpperCase()}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-white">{guest.name}</span>
          {guest.email && (
            <span className="text-white/50 text-sm truncate">{guest.email}</span>
          )}
        </div>

        {/* Promote button */}
        {onPromote && (
          <button
            onClick={() => guest.id && onPromote(guest.id)}
            className="flex items-center gap-1.5 text-[#39d98a] hover:bg-[#39d98a]/10 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium"
          >
            <ArrowUpCircle size={16} />
            <span>Promote</span>
          </button>
        )}

        {/* Delete */}
        {onRemove && (
          <button
            onClick={() => guest.id && onRemove(guest.id)}
            className="p-1.5 text-white/30 hover:text-[#ff393a] hover:bg-[#ff393a]/10 rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
            aria-label="Remove guest"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-3 group hover:bg-white/5 -mx-2 px-2 rounded-lg transition-colors">
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-full ${getAvatarColor(guest.name)} flex items-center justify-center text-white text-sm font-medium flex-shrink-0`}>
        {guest.name.charAt(0).toUpperCase()}
      </div>

      {/* Content - varies by variant */}
      {variant === 'basic' ? (
        // Basic variant: Name & Email
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-white">{guest.name}</span>
          {guest.email && (
            <span className="text-white/50 text-sm truncate">{guest.email}</span>
          )}
          {guest.roles && guest.roles.length > 0 && (
            <div className="flex gap-1">
              {guest.roles.map(role => (
                <span key={role} className="px-1.5 py-0.5 bg-white/10 text-white/60 text-[10px] rounded">
                  {role}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        // Requests variant: Name on left, Preferences on right
        <>
          <span className="font-semibold text-white flex-shrink-0">{guest.name}</span>
          <div className="flex-1 min-w-0 flex flex-wrap gap-1 justify-end">
            {guest.dietaryRestrictions.map(restriction => (
              <span key={restriction} className="px-1.5 py-0.5 bg-purple-500/20 text-purple-300 text-[10px] rounded border border-purple-500/30">
                {restriction}
              </span>
            ))}
            {guest.toppings.map(toppingId => {
              const name = toppingNameById(toppingId);
              return (
                <span key={toppingId} className="px-1.5 py-0.5 bg-[#39d98a]/20 text-[#39d98a] text-[10px] rounded">
                  {getToppingEmoji(name)} {name}
                </span>
              );
            })}
            {guest.dislikedToppings.map(toppingId => {
              const name = toppingNameById(toppingId);
              return (
                <span key={toppingId} className="px-1.5 py-0.5 bg-[#ff393a]/20 text-[#ff393a] text-[10px] rounded line-through">
                  {getToppingEmoji(name)} {name}
                </span>
              );
            })}
            {guest.likedBeverages?.map(beverageId => {
              const name = beverageNameById(beverageId);
              return (
                <span key={beverageId} className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] rounded">
                  {name}
                </span>
              );
            })}
            {guest.dislikedBeverages?.map(beverageId => {
              const name = beverageNameById(beverageId);
              return (
                <span key={beverageId} className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] rounded line-through">
                  {name}
                </span>
              );
            })}
          </div>
        </>
      )}

      {/* Approve/Decline buttons */}
      {requireApproval && guest.approved === null && onApprove && onDecline && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => guest.id && onApprove(guest.id)}
            className="flex items-center gap-1 text-[#39d98a] hover:bg-[#39d98a]/10 px-2 py-1 rounded transition-colors text-sm"
          >
            <Check size={14} />
            <span>Approve</span>
          </button>
          <button
            onClick={() => guest.id && onDecline(guest.id)}
            className="flex items-center gap-1 text-[#ff393a] hover:bg-[#ff393a]/10 px-2 py-1 rounded transition-colors text-sm"
          >
            <X size={14} />
            <span>Decline</span>
          </button>
        </div>
      )}

      {/* Status badge for approved/declined */}
      {requireApproval && guest.approved === true && (
        <span className="text-[#39d98a] text-xs flex-shrink-0">Approved</span>
      )}
      {requireApproval && guest.approved === false && (
        <span className="text-[#ff393a] text-xs flex-shrink-0">Declined</span>
      )}

      {/* Date - only for basic variant */}
      {variant === 'basic' && guest.submittedAt && (
        <span className="text-white/40 text-sm hidden sm:block flex-shrink-0">
          {format(new Date(guest.submittedAt), 'MMM d, yyyy')}
        </span>
      )}

      {/* Delete */}
      {onRemove && (
        <button
          onClick={() => guest.id && onRemove(guest.id)}
          className="p-1.5 text-white/30 hover:text-[#ff393a] hover:bg-[#ff393a]/10 rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
          aria-label="Remove guest"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
};
