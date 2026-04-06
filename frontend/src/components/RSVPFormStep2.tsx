import React from 'react';
import { ThumbsUp, ThumbsDown, Loader2, ChevronLeft, X, Square, CheckSquare2, Star, MapPin, Plus } from 'lucide-react';
import { DIETARY_OPTIONS, TOPPINGS, DRINKS } from '../constants/options';
import { PlaceAutocomplete } from './PlaceAutocomplete';
import { calculateDistanceMiles, formatDistanceMiles } from '../lib/ordering';
import type { useRSVPForm } from '../hooks/useRSVPForm';

interface RSVPFormStep2Props {
  form: ReturnType<typeof useRSVPForm>;
  isEditing?: boolean;
  donationSlot?: React.ReactNode; // For wrapper-specific donation UI
  submitLabel?: string; // Default "RSVP"
}

export function RSVPFormStep2({
  form,
  isEditing,
  donationSlot,
  submitLabel,
}: RSVPFormStep2Props) {
  const label = submitLabel ?? (isEditing ? 'Edit RSVP' : 'RSVP');

  return (
    <form onSubmit={form.handleSubmit} className="space-y-3">
      {/* Dietary Restrictions */}
      <div>
        <label className="block text-sm font-medium text-theme-text mb-3">
          Diet
        </label>
        <div className="flex flex-wrap gap-2">
          {DIETARY_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => form.toggleDietary(option)}
              className={`px-4 py-2 rounded-lg transition-colors border ${
                form.dietaryRestrictions.includes(option)
                  ? 'border-[#ff393a] bg-theme-surface-hover text-theme-text'
                  : 'border-theme-stroke bg-theme-surface-hover text-theme-text-secondary hover:bg-theme-surface-hover'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {/* Toppings */}
      <div>
        <label className="block text-sm font-medium text-theme-text mb-3">
          Toppings
        </label>
        <div className="flex flex-wrap gap-2">
          {TOPPINGS.filter(t => form.availableToppings.length === 0 || form.availableToppings.includes(t.id)).map((topping) => {
            const isLiked = form.likedToppings.includes(topping.id);
            const isDisliked = form.dislikedToppings.includes(topping.id);
            const isExcluded = form.excludedToppings.has(topping.id);

            return (
              <div
                key={topping.id}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${
                  isExcluded
                    ? 'opacity-40 cursor-not-allowed bg-theme-surface border-theme-stroke'
                    : isLiked
                      ? 'bg-[#39d98a]/20 border-[#39d98a]/30'
                      : isDisliked
                        ? 'bg-[#ff393a]/20 border-[#ff393a]/30'
                        : 'bg-theme-surface border-theme-stroke'
                }`}
              >
                <button
                  type="button"
                  onClick={() => !isExcluded && form.handleToppingLike(topping.id)}
                  disabled={isExcluded}
                  className={`flex items-center gap-1.5 flex-1 py-0.5 transition-opacity ${isExcluded ? 'cursor-not-allowed' : 'hover:opacity-70'}`}
                >
                  <ThumbsUp
                    size={12}
                    className={`transition-all ${isLiked ? 'text-[#39d98a]' : 'text-theme-text-faint'}`}
                  />
                  <span className={`text-xs ${isExcluded ? 'line-through text-theme-text-muted' : 'text-theme-text'}`}>{topping.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => !isExcluded && form.handleToppingDislike(topping.id)}
                  disabled={isExcluded}
                  className={`p-0.5 transition-opacity ${isExcluded ? 'cursor-not-allowed' : 'hover:opacity-70'}`}
                >
                  <ThumbsDown
                    size={12}
                    className={`transition-all ${isDisliked ? 'text-[#ff393a]' : 'text-theme-text-faint'}`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Drinks */}
      {form.availableBeverages.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-theme-text mb-3">
            Drink Preferences
          </label>
          <div className="flex flex-wrap gap-2">
            {DRINKS.filter(d => form.availableBeverages.includes(d.id)).map((drink) => {
              const isLiked = form.likedBeverages.includes(drink.id);
              const isDisliked = form.dislikedBeverages.includes(drink.id);

              return (
                <div
                  key={drink.id}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${
                    isLiked
                      ? 'bg-[#39d98a]/20 border-[#39d98a]/30'
                      : isDisliked
                        ? 'bg-[#ff393a]/20 border-[#ff393a]/30'
                        : 'bg-theme-surface border-theme-stroke'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => form.handleDrinkLike(drink.id)}
                    className="flex items-center gap-1.5 flex-1 py-0.5 hover:opacity-70 transition-opacity"
                  >
                    <ThumbsUp
                      size={12}
                      className={`transition-all ${isLiked ? 'text-[#39d98a]' : 'text-theme-text-faint'}`}
                    />
                    <span className="text-theme-text text-xs">{drink.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => form.handleDrinkDislike(drink.id)}
                    className="p-0.5 hover:opacity-70 transition-opacity"
                  >
                    <ThumbsDown
                      size={12}
                      className={`transition-all ${isDisliked ? 'text-[#ff393a]' : 'text-theme-text-faint'}`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pizzeria Rankings */}
      {form.nearbyPizzerias.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-theme-text mb-3">
            Favorite Pizzerias <span className="text-theme-text-muted font-normal">(click to rank 1-3)</span>
          </label>
          {form.loadingPizzerias ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={20} className="animate-spin text-theme-text-muted" />
            </div>
          ) : (
            <div className="space-y-2">
              {form.nearbyPizzerias.map((pizzeria) => {
                const rankIndex = form.pizzeriaRankings.indexOf(pizzeria.id);
                const rank = rankIndex !== -1 ? rankIndex + 1 : null;

                return (
                  <button
                    key={pizzeria.id}
                    type="button"
                    onClick={() => form.handlePizzeriaClick(pizzeria.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                      rank
                        ? 'bg-[#ff393a]/20 border-[#ff393a]/30'
                        : 'bg-theme-surface border-theme-stroke hover:bg-theme-surface-hover'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm ${
                      rank
                        ? 'bg-[#ff393a] text-white'
                        : 'bg-theme-surface-hover text-theme-text-faint'
                    }`}>
                      {rank || '\u2014'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-theme-text truncate">{pizzeria.name}</span>
                        {pizzeria.rating && (
                          <span className="flex items-center gap-0.5 text-yellow-400 text-xs">
                            <Star size={10} className="fill-yellow-400" />
                            {pizzeria.rating.toFixed(1)}
                          </span>
                        )}
                        {form.venueLocation && pizzeria.location && pizzeria.location.lat !== 0 && (
                          <span className="text-xs text-theme-text-muted">
                            {formatDistanceMiles(calculateDistanceMiles(form.venueLocation.lat, form.venueLocation.lng, pizzeria.location.lat, pizzeria.location.lng))}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-theme-text-muted">
                        <MapPin size={10} />
                        <span className="truncate">{pizzeria.address}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Suggest a Pizzeria button */}
          <button
            type="button"
            onClick={() => form.setShowSuggestModal(true)}
            className="w-full flex items-center justify-center gap-2 p-2.5 mt-2 rounded-xl border border-dashed border-theme-stroke-hover text-theme-text-muted hover:text-theme-text hover:border-theme-stroke-hover hover:bg-theme-surface transition-all text-sm"
          >
            <Plus size={14} />
            Suggest a Pizzeria
          </button>
        </div>
      )}

      {/* Suggest Pizzeria Sub-Modal */}
      {form.showSuggestModal && (
        <div className="p-4 bg-theme-surface rounded-xl border border-theme-stroke">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-theme-text">Suggest a pizzeria</p>
            <button
              type="button"
              onClick={() => form.setShowSuggestModal(false)}
              className="text-theme-text-muted hover:text-theme-text"
            >
              <X size={16} />
            </button>
          </div>
          <PlaceAutocomplete
            onPlaceSelected={(place) => form.handleSuggestPizzeria(place)}
            placeholder="Search for a pizzeria..."
            autoFocus
          />
        </div>
      )}

      {/* Error display */}
      {form.error && (
        <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
          {form.error}
        </div>
      )}

      {/* Donation slot */}
      {donationSlot}

      {/* Save to Profile Checkbox */}
      {form.email.trim() && (
        <button
          type="button"
          onClick={() => form.setSaveToProfile(!form.saveToProfile)}
          className="flex items-center gap-3 w-full p-3 bg-theme-surface border border-theme-stroke rounded-xl hover:bg-theme-surface-hover transition-colors"
        >
          {form.saveToProfile ? (
            <CheckSquare2 size={20} className="text-[#ff393a] flex-shrink-0" />
          ) : (
            <Square size={20} className="text-theme-text-muted flex-shrink-0" />
          )}
          <div className="text-left">
            <span className="text-sm font-medium text-theme-text">Save to profile</span>
            <p className="text-xs text-theme-text-muted">Remember my preferences for future events</p>
          </div>
        </button>
      )}

      {/* Navigation buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => form.setStep(1)}
          className="btn-secondary flex items-center gap-2"
        >
          <ChevronLeft size={18} />
          Back
        </button>
        <button
          type="submit"
          disabled={form.submitting}
          className="flex-1 btn-primary flex items-center justify-center gap-2"
          data-testid="rsvp-submit"
        >
          {form.submitting ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              {isEditing ? 'Saving...' : 'Submitting...'}
            </>
          ) : (
            label
          )}
        </button>
      </div>
    </form>
  );
}
