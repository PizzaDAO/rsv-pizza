import React, { useState } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { Guest } from '../types';
import { UserPlus, Loader2, ThumbsUp, ThumbsDown, User, X } from 'lucide-react';
import { IconInput } from './IconInput';

interface AddGuestFormProps {
  onClose?: () => void;
}

export const AddGuestForm: React.FC<AddGuestFormProps> = ({ onClose }) => {
  const { availableToppings, availableBeverages, addGuest, dietaryOptions, party } = usePizza();
  const [name, setName] = useState('');
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [toppings, setToppings] = useState<string[]>([]);
  const [dislikedToppings, setDislikedToppings] = useState<string[]>(['anchovies']);
  const [likedBeverages, setLikedBeverages] = useState<string[]>([]);
  const [dislikedBeverages, setDislikedBeverages] = useState<string[]>([]);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setName('');
    setDietaryRestrictions([]);
    setToppings([]);
    setDislikedToppings(['anchovies']);
    setLikedBeverages([]);
    setDislikedBeverages([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      return;
    }

    setIsSubmitting(true);
    await addGuest({
      name,
      dietaryRestrictions,
      toppings,
      dislikedToppings,
      likedBeverages,
      dislikedBeverages
    });
    setIsSubmitting(false);
    resetForm();
    setIsFormVisible(false);
    onClose?.(); // Close modal if in modal mode
  };

  const handleDietaryChange = (option: string) => {
    setDietaryRestrictions(prev =>
      prev.includes(option)
        ? prev.filter(item => item !== option)
        : [...prev, option]
    );
  };

  const handleToppingLike = (toppingId: string) => {
    setDislikedToppings(prev => prev.filter(id => id !== toppingId));
    setToppings(prev => prev.includes(toppingId) ? prev.filter(id => id !== toppingId) : [...prev, toppingId]);
  };

  const handleToppingDislike = (toppingId: string) => {
    setToppings(prev => prev.filter(id => id !== toppingId));
    setDislikedToppings(prev => prev.includes(toppingId) ? prev.filter(id => id !== toppingId) : [...prev, toppingId]);
  };

  const handleBeverageLike = (beverageId: string) => {
    setDislikedBeverages(prev => prev.filter(id => id !== beverageId));
    setLikedBeverages(prev => prev.includes(beverageId) ? prev.filter(id => id !== beverageId) : [...prev, beverageId]);
  };

  const handleBeverageDislike = (beverageId: string) => {
    setLikedBeverages(prev => prev.filter(id => id !== beverageId));
    setDislikedBeverages(prev => prev.includes(beverageId) ? prev.filter(id => id !== beverageId) : [...prev, beverageId]);
  };

  // Modal mode: always show form, ignore isFormVisible
  const shouldShowForm = onClose ? true : isFormVisible;

  return (
    <div className="card p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-white">Add Guest</h2>
        {onClose ? (
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        ) : !isFormVisible ? (
          <button
            onClick={() => setIsFormVisible(true)}
            className="btn-primary flex items-center space-x-2"
          >
            <UserPlus size={18} />
            <span>Add Guest</span>
          </button>
        ) : null}
      </div>

      {shouldShowForm && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <IconInput
            icon={User}
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Guest Name"
            required
          />

          <div>
            <h3 className="text-sm font-medium text-white/60 mb-2">
              Dietary Restrictions
            </h3>
            <div className="flex flex-wrap gap-2">
              {dietaryOptions.map(option => (
                <button
                  type="button"
                  key={option}
                  onClick={() => handleDietaryChange(option)}
                  className={`chip ${dietaryRestrictions.includes(option) ? 'active' : ''}`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-white/60 mb-3">
              Topping Preferences
            </h3>
            <div className="flex flex-wrap gap-2">
              {availableToppings.map(topping => {
                const isLiked = toppings.includes(topping.id);
                const isDisliked = dislikedToppings.includes(topping.id);
                return (
                  <div
                    key={topping.id}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${
                      isLiked
                        ? 'bg-[#39d98a]/20 border-[#39d98a]/30'
                        : isDisliked
                        ? 'bg-[#ff393a]/20 border-[#ff393a]/30'
                        : 'bg-white/5 border-white/10'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleToppingLike(topping.id)}
                      className="flex items-center gap-1.5 flex-1 py-0.5 hover:opacity-70 transition-opacity"
                    >
                      <ThumbsUp
                        size={12}
                        className={`transition-all ${
                          isLiked ? 'text-[#39d98a]' : 'text-white/20'
                        }`}
                      />
                      <span className="text-white text-xs">{topping.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToppingDislike(topping.id)}
                      className="p-0.5 hover:opacity-70 transition-opacity"
                    >
                      <ThumbsDown
                        size={12}
                        className={`transition-all ${
                          isDisliked ? 'text-[#ff393a]' : 'text-white/20'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Beverage Preferences - Only show if party has beverages configured */}
          {party?.availableBeverages && party.availableBeverages.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-white/60 mb-3">
                Beverage Preferences
              </h3>
              <div className="flex flex-wrap gap-2">
                {availableBeverages
                  .filter(bev => party.availableBeverages?.includes(bev.id))
                  .map(beverage => {
                    const isLiked = likedBeverages.includes(beverage.id);
                    const isDisliked = dislikedBeverages.includes(beverage.id);
                    return (
                      <div
                        key={beverage.id}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${
                          isLiked
                            ? 'bg-[#39d98a]/20 border-[#39d98a]/30'
                            : isDisliked
                            ? 'bg-[#ff393a]/20 border-[#ff393a]/30'
                            : 'bg-white/5 border-white/10'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleBeverageLike(beverage.id)}
                          className="flex items-center gap-1.5 flex-1 py-0.5 hover:opacity-70 transition-opacity"
                        >
                          <ThumbsUp
                            size={12}
                            className={`transition-all ${
                              isLiked ? 'text-[#39d98a]' : 'text-white/20'
                            }`}
                          />
                          <span className="text-white text-xs">{beverage.name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBeverageDislike(beverage.id)}
                          className="p-0.5 hover:opacity-70 transition-opacity"
                        >
                          <ThumbsDown
                            size={12}
                            className={`transition-all ${
                              isDisliked ? 'text-[#ff393a]' : 'text-white/20'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="flex space-x-3 pt-2">
            <button
              type="submit"
              className="btn-primary flex items-center gap-2"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Guest'
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setIsFormVisible(false);
              }}
              className="btn-secondary"
              disabled={isSubmitting}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
