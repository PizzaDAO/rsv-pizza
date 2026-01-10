import React, { useState } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { Guest } from '../types';
import { UserPlus, Loader2 } from 'lucide-react';

export const AddGuestForm: React.FC = () => {
  const { availableToppings, addGuest, dietaryOptions } = usePizza();
  const [name, setName] = useState('');
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [toppings, setToppings] = useState<string[]>([]);
  const [dislikedToppings, setDislikedToppings] = useState<string[]>([]);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setName('');
    setDietaryRestrictions([]);
    setToppings([]);
    setDislikedToppings([]);
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
      dislikedToppings
    });
    setIsSubmitting(false);
    resetForm();
    setIsFormVisible(false);
  };

  const handleDietaryChange = (option: string) => {
    setDietaryRestrictions(prev =>
      prev.includes(option)
        ? prev.filter(item => item !== option)
        : [...prev, option]
    );
  };

  const handleToppingChange = (toppingId: string, list: 'liked' | 'disliked') => {
    if (list === 'liked') {
      if (dislikedToppings.includes(toppingId)) {
        setDislikedToppings(prev => prev.filter(id => id !== toppingId));
      }
      setToppings(prev =>
        prev.includes(toppingId)
          ? prev.filter(id => id !== toppingId)
          : [...prev, toppingId]
      );
    } else {
      if (toppings.includes(toppingId)) {
        setToppings(prev => prev.filter(id => id !== toppingId));
      }
      setDislikedToppings(prev =>
        prev.includes(toppingId)
          ? prev.filter(id => id !== toppingId)
          : [...prev, toppingId]
      );
    }
  };

  return (
    <div className="card p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-white">Add Guest</h2>
        {!isFormVisible && (
          <button
            onClick={() => setIsFormVisible(true)}
            className="btn-primary flex items-center space-x-2"
          >
            <UserPlus size={18} />
            <span>Add Guest</span>
          </button>
        )}
      </div>

      {isFormVisible && (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="name" className="block text-white/80 font-medium mb-2">
              Guest Name
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full"
              placeholder="Enter guest name"
              required
            />
          </div>

          <div>
            <label className="block text-white/80 font-medium mb-2">
              Dietary Restrictions
            </label>
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
            <label className="block text-white/80 font-medium mb-3">
              Topping Preferences
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-medium text-white/60 mb-2">Liked Toppings</h3>
                <div className="flex flex-wrap gap-2">
                  {availableToppings.map(topping => (
                    <button
                      type="button"
                      key={`like-${topping.id}`}
                      onClick={() => handleToppingChange(topping.id, 'liked')}
                      className={`chip ${toppings.includes(topping.id) ? 'liked' : ''}`}
                    >
                      {topping.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-white/60 mb-2">Disliked Toppings</h3>
                <div className="flex flex-wrap gap-2">
                  {availableToppings.map(topping => (
                    <button
                      type="button"
                      key={`dislike-${topping.id}`}
                      onClick={() => handleToppingChange(topping.id, 'disliked')}
                      className={`chip ${dislikedToppings.includes(topping.id) ? 'disliked' : ''}`}
                    >
                      {topping.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

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
