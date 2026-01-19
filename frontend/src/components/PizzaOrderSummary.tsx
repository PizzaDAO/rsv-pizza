import React, { useState, useEffect } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { PizzeriaSearch } from './PizzeriaSearch';
import { OrderCheckout } from './OrderCheckout';
import { LocationAutocomplete } from './LocationAutocomplete';
import { TableRow } from './TableRow';
import { Pizzeria, OrderingOption } from '../types';
import { ClipboardList, Share2, Check, ShoppingCart, X, ExternalLink, Search, Star, Phone, Loader2, Navigation, Clock, ChevronDown, ChevronUp, Beer } from 'lucide-react';
import { format } from 'date-fns';
import {
  searchPizzerias,
  getCurrentLocation,
  geocodeAddress,
  formatDistance,
  getProviderName,
  getProviderColor,
  supportsDirectOrdering,
} from '../lib/ordering';

export const PizzaOrderSummary: React.FC = () => {
  const { recommendations, beverageRecommendations, waveRecommendations, party, guests, orderExpectedGuests, setOrderExpectedGuests, generateRecommendations } = usePizza();
  const [isCopied, setIsCopied] = useState(false);
  const [showCallScript, setShowCallScript] = useState(false);
  const [showPizzeriaSearch, setShowPizzeriaSearch] = useState(false);
  const [selectedPizzeria, setSelectedPizzeria] = useState<Pizzeria | null>(null);
  const [selectedOption, setSelectedOption] = useState<OrderingOption | null>(null);
  const [orderComplete, setOrderComplete] = useState<{ orderId: string; checkoutUrl?: string } | null>(null);

  // Inline pizzeria search state
  const [pizzerias, setPizzerias] = useState<Pizzeria[]>([]);
  const [pizzeriaLoading, setPizzeriaLoading] = useState(false);
  const [pizzeriaError, setPizzeriaError] = useState<string | null>(null);
  const [searchAddress, setSearchAddress] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [autoSearched, setAutoSearched] = useState(false);

  // Auto-search if party address is provided
  useEffect(() => {
    if (party?.address && !autoSearched && recommendations.length > 0) {
      setAutoSearched(true);
      setSearchAddress(party.address);
      handleAddressSearchAuto(party.address);
    }
  }, [party?.address, recommendations.length]);

  const handleAddressSearchAuto = async (address: string) => {
    setPizzeriaLoading(true);
    setPizzeriaError(null);
    try {
      const location = await geocodeAddress(address);
      if (!location) {
        setPizzeriaError('Could not find that address. Please try a different one.');
        return;
      }
      const results = await searchPizzerias(location.lat, location.lng);
      setPizzerias(results);
      setHasSearched(true);
    } catch (err) {
      setPizzeriaError(err instanceof Error ? err.message : 'Failed to search');
    } finally {
      setPizzeriaLoading(false);
    }
  };

  const handleUseCurrentLocation = async () => {
    setPizzeriaLoading(true);
    setPizzeriaError(null);
    try {
      const location = await getCurrentLocation();
      const results = await searchPizzerias(location.lat, location.lng);
      setPizzerias(results);
      setHasSearched(true);
    } catch (err) {
      setPizzeriaError(err instanceof Error ? err.message : 'Failed to get location');
    } finally {
      setPizzeriaLoading(false);
    }
  };

  const handleAddressSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchAddress.trim()) return;

    setPizzeriaLoading(true);
    setPizzeriaError(null);
    try {
      const location = await geocodeAddress(searchAddress);
      if (!location) {
        setPizzeriaError('Could not find that address. Please try a different one.');
        return;
      }
      const results = await searchPizzerias(location.lat, location.lng);
      setPizzerias(results);
      setHasSearched(true);
    } catch (err) {
      setPizzeriaError(err instanceof Error ? err.message : 'Failed to search');
    } finally {
      setPizzeriaLoading(false);
    }
  };

  const renderStars = (rating: number | undefined) => {
    if (!rating) return null;
    return (
      <div className="flex items-center gap-1">
        <Star size={12} className="text-yellow-400 fill-yellow-400" />
        <span className="text-white text-xs font-medium">{rating.toFixed(1)}</span>
      </div>
    );
  };

  const handleInlineSelectPizzeria = (pizzeria: Pizzeria, option: OrderingOption) => {
    setSelectedPizzeria(pizzeria);
    setSelectedOption(option);
  };

  // Generate call script for phone ordering
  const generateCallScript = () => {
    if (waveRecommendations.length === 0) return '';

    // Single wave mode
    if (waveRecommendations.length === 1) {
      const sortedPizzas = [...waveRecommendations[0].pizzas].sort((a, b) => (b.quantity || 1) - (a.quantity || 1));
      const pizzaLines = sortedPizzas.map(pizza => {
        const qty = pizza.quantity || 1;
        const size = pizza.size.name;
        const dietary = pizza.dietaryRestrictions?.length > 0
          ? ` (${pizza.dietaryRestrictions.join(', ')})`
          : '';

        if (pizza.isHalfAndHalf && pizza.leftHalf && pizza.rightHalf) {
          const leftToppings = pizza.leftHalf.toppings.map(t => t.name).join(', ') || 'cheese';
          const rightToppings = pizza.rightHalf.toppings.map(t => t.name).join(', ') || 'cheese';
          return `  - ${qty}x ${size} pizza, half ${leftToppings} and half ${rightToppings}${dietary}`;
        }

        const toppingsText = pizza.toppings.map(t => t.name).join(', ');
        return `  - ${qty}x ${size} pizza with ${toppingsText || 'cheese'}${dietary}`;
      }).join('\n');

      const totalPizzas = waveRecommendations[0].totalPizzas;
      const deliveryAddress = party?.address || '[YOUR ADDRESS]';

      return `Hi, I'd like to place an order for delivery.

I need ${totalPizzas} pizza${totalPizzas !== 1 ? 's' : ''}:
${pizzaLines}

Delivery address: ${deliveryAddress}

Can you give me the total and estimated delivery time?`;
    }

    // Multi-wave mode
    const waveScripts = waveRecommendations.map(waveRec => {
      const arrivalTime = format(waveRec.wave.arrivalTime, 'h:mm a');
      const pizzaLines = waveRec.pizzas
        .sort((a, b) => (b.quantity || 1) - (a.quantity || 1))
        .map(pizza => {
          const qty = pizza.quantity || 1;
          const size = pizza.size.name;
          const toppingsText = pizza.toppings.map(t => t.name).join(', ');
          const label = pizza.label || toppingsText;
          return `  - ${qty}x ${size} ${label}`;
        })
        .join('\n');

      return `${waveRec.wave.label} (arrive at ${arrivalTime}):\n${pizzaLines}`;
    }).join('\n\n');

    const deliveryAddress = party?.address || '[YOUR ADDRESS]';

    return `Hi, I'd like to place a multi-wave delivery order:

${waveScripts}

Delivery address: ${deliveryAddress}

Can you accommodate these delivery times? Please confirm total and timing.`;
  };

  // Calculate totals
  const totalPizzas = waveRecommendations.length > 1
    ? waveRecommendations.reduce((acc, wave) => acc + wave.totalPizzas, 0)
    : recommendations.reduce((acc, pizza) => acc + (pizza.quantity || 1), 0);
  const respondedGuests = guests.length;
  const expectedGuests = party?.maxGuests || respondedGuests;

  const handleCopyOrder = () => {
    if (recommendations.length === 0) return;

    const orderText = [...recommendations]
      .sort((a, b) => (b.quantity || 1) - (a.quantity || 1))
      .map(pizza => {
        const qty = pizza.quantity || 1;

        // Handle half-and-half pizzas
        if (pizza.isHalfAndHalf && pizza.leftHalf && pizza.rightHalf) {
          const leftToppings = pizza.leftHalf.toppings.map(t => t.name).join(', ') || 'cheese';
          const rightToppings = pizza.rightHalf.toppings.map(t => t.name).join(', ') || 'cheese';
          return `${qty}x Half ${leftToppings} / Half ${rightToppings} (${pizza.size.diameter}" ${pizza.style.name}) - serves ${pizza.guestCount}`;
        }

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

  const handleCopyWave = (waveIndex: number) => {
    const waveRec = waveRecommendations[waveIndex];
    if (!waveRec) return;

    const pizzaText = waveRec.pizzas
      .sort((a, b) => (b.quantity || 1) - (a.quantity || 1))
      .map(pizza => {
        const qty = pizza.quantity || 1;

        // Handle half-and-half pizzas
        if (pizza.isHalfAndHalf && pizza.leftHalf && pizza.rightHalf) {
          const leftToppings = pizza.leftHalf.toppings.map(t => t.name).join(', ') || 'cheese';
          const rightToppings = pizza.rightHalf.toppings.map(t => t.name).join(', ') || 'cheese';
          return `${qty}x Half ${leftToppings} / Half ${rightToppings} (${pizza.size.diameter}" ${pizza.style.name})`;
        }

        const toppingsText = pizza.toppings.map(t => t.name).join(', ');
        const label = pizza.label || toppingsText;
        return `${qty}x ${label} (${pizza.size.diameter}" ${pizza.style.name})`;
      })
      .join('\n');

    const arrivalTime = format(waveRec.wave.arrivalTime, 'MMMM d, yyyy \'at\' h:mm a');
    const fullText = `${waveRec.wave.label.toUpperCase()}\nArrival: ${arrivalTime}\nGuests: ${waveRec.wave.guestAllocation}\n\nPIZZAS:\n${pizzaText}`;

    navigator.clipboard.writeText(fullText)
      .then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      })
      .catch(err => console.error('Failed to copy:', err));
  };

  const handleCopyAllWaves = () => {
    const allWavesText = waveRecommendations.map((waveRec, index) => {
      const pizzaText = waveRec.pizzas
        .sort((a, b) => (b.quantity || 1) - (a.quantity || 1))
        .map(pizza => {
          const qty = pizza.quantity || 1;

          // Handle half-and-half pizzas
          if (pizza.isHalfAndHalf && pizza.leftHalf && pizza.rightHalf) {
            const leftToppings = pizza.leftHalf.toppings.map(t => t.name).join(', ') || 'cheese';
            const rightToppings = pizza.rightHalf.toppings.map(t => t.name).join(', ') || 'cheese';
            return `  ${qty}x Half ${leftToppings} / Half ${rightToppings} (${pizza.size.diameter}" ${pizza.style.name})`;
          }

          const toppingsText = pizza.toppings.map(t => t.name).join(', ');
          const label = pizza.label || toppingsText;
          return `  ${qty}x ${label} (${pizza.size.diameter}" ${pizza.style.name})`;
        })
        .join('\n');

      const arrivalTime = format(waveRec.wave.arrivalTime, 'h:mm a');
      return `=== ${waveRec.wave.label} (${arrivalTime}) ===\nGuests: ${waveRec.wave.guestAllocation}\n${pizzaText}`;
    }).join('\n\n');

    // Add beverages as separate section (not per wave)
    const beverageText = beverageRecommendations.length > 0
      ? '\n\n=== BEVERAGES (Order Once) ===\n' + beverageRecommendations.map(b => `${b.quantity}x ${b.beverage.name}`).join('\n')
      : '';

    const header = `MULTI-WAVE PIZZA ORDER\nParty: ${party?.name || 'Pizza Party'}\nTotal Guests: ${party?.maxGuests || guests.length}\n\n`;

    navigator.clipboard.writeText(header + allWavesText + beverageText)
      .then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      })
      .catch(err => console.error('Failed to copy:', err));
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
      <div className="card p-6">
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
              <div className="space-y-2 text-sm">
                <p className="text-white/80">
                  <span className="text-white/60">Total pizzas:</span>{' '}
                  <span className="font-semibold text-white text-base">{totalPizzas}</span>
                </p>
                {waveRecommendations.length > 1 && (
                  <>
                    {waveRecommendations.map((waveRec) => (
                      <p key={waveRec.wave.id} className="text-white/80 pl-3 border-l-2 border-white/20">
                        <span className="text-white/60">{waveRec.wave.label}:</span>{' '}
                        <span className="font-semibold text-white">{waveRec.totalPizzas} pizza{waveRec.totalPizzas !== 1 ? 's' : ''}</span>
                        <span className="text-white/50"> at {format(waveRec.wave.arrivalTime, 'h:mm a')}</span>
                      </p>
                    ))}
                  </>
                )}
                {beverageRecommendations.length > 0 && (
                  <>
                    <p className="text-white/80 pt-1 border-t border-white/10 mt-2">
                      <span className="text-white/60">Total drinks:</span>{' '}
                      <span className="font-semibold text-white text-base">
                        {beverageRecommendations.reduce((acc, rec) => acc + rec.quantity, 0)}
                      </span>
                    </p>
                    {beverageRecommendations.map((rec) => (
                      <p key={rec.id} className="text-white/80 pl-3 border-l-2 border-blue-500/30">
                        <span className="font-semibold text-white">{rec.quantity}x</span>{' '}
                        <span className="text-white/80">{rec.beverage.name}</span>
                      </p>
                    ))}
                  </>
                )}
              </div>
            </div>

            {waveRecommendations.length > 1 ? (
              // Multi-wave display
              <div className="space-y-3 mb-4">
                {waveRecommendations.map((waveRec, waveIndex) => (
                  <div
                    key={waveRec.wave.id}
                    className="border border-white/20 rounded-xl p-4 bg-white/5"
                  >
                    {/* Wave Header */}
                    <div className="flex items-center justify-between mb-3 pb-3 border-b border-white/10">
                      <div>
                        <h3 className="font-semibold text-white flex items-center gap-2">
                          <Clock size={16} />
                          {waveRec.wave.label}
                        </h3>
                        <p className="text-sm text-white/60 mt-1">
                          Arrive at {format(waveRec.wave.arrivalTime, 'h:mm a')} •{' '}
                          {waveRec.totalPizzas} pizza{waveRec.totalPizzas !== 1 ? 's' : ''} for ~{waveRec.wave.guestAllocation} guest{waveRec.wave.guestAllocation !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <button
                        onClick={() => handleCopyWave(waveIndex)}
                        className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
                      >
                        <Share2 size={14} />
                        Copy Wave
                      </button>
                    </div>

                    {/* Pizza List */}
                    <div className="divide-y divide-white/10">
                      {waveRec.pizzas
                        .sort((a, b) => (b.quantity || 1) - (a.quantity || 1))
                        .map((pizza, pizzaIndex) => (
                          <TableRow key={pizza.id} pizzaRec={pizza} pizzaIndex={pizzaIndex} variant="pizza" />
                        ))}
                    </div>
                  </div>
                ))}

                {/* Beverage Order Section - Separate from waves */}
                {beverageRecommendations.length > 0 && (
                  <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                    <h3 className="font-medium text-blue-400 mb-3 flex items-center gap-2">
                      <Beer size={16} />
                      Beverage Order (Order Once)
                    </h3>
                    <div className="space-y-1 text-sm mb-3">
                      <p className="text-white/80">
                        <span className="text-white/60">Total beverages:</span>{' '}
                        <span className="font-semibold text-white text-base">
                          {beverageRecommendations.reduce((acc, rec) => acc + rec.quantity, 0)}
                        </span>
                      </p>
                    </div>
                    <div className="divide-y divide-white/10">
                      {beverageRecommendations.map(rec => (
                        <TableRow key={rec.id} beverageRec={rec} variant="beverage" />
                      ))}
                    </div>
                  </div>
                )}

                {/* Copy All Waves Button */}
                <button
                  onClick={handleCopyAllWaves}
                  className="w-full btn-secondary flex items-center justify-center gap-2 mt-4"
                >
                  <Share2 size={16} />
                  Copy All Waves
                </button>
              </div>
            ) : (
              // Single wave display (row-based)
              <>
                <div className="divide-y divide-white/10 mb-4">
                  {[...recommendations]
                    .sort((a, b) => (b.quantity || 1) - (a.quantity || 1))
                    .map((pizza, index) => (
                      <TableRow key={pizza.id} pizzaRec={pizza} pizzaIndex={index} variant="pizza" />
                    ))}
                </div>

                {/* Beverage Order Section */}
                {beverageRecommendations.length > 0 && (
                  <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                    <h3 className="font-medium text-blue-400 mb-3 flex items-center gap-2">
                      <Beer size={16} />
                      Beverage Order
                    </h3>
                    <div className="space-y-1 text-sm mb-3">
                      <p className="text-white/80">
                        <span className="text-white/60">Total beverages:</span>{' '}
                        <span className="font-semibold text-white text-base">
                          {beverageRecommendations.reduce((acc, rec) => acc + rec.quantity, 0)}
                        </span>
                      </p>
                    </div>
                    <div className="divide-y divide-white/10">
                      {beverageRecommendations.map(rec => (
                        <TableRow key={rec.id} beverageRec={rec} variant="beverage" />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Copy Order & Call Script buttons */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={handleCopyOrder}
                disabled={recommendations.length === 0}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl font-medium text-sm transition-all ${isCopied
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
                    <span>Copy Order</span>
                  </>
                )}
              </button>

              <button
                onClick={() => setShowCallScript(!showCallScript)}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl font-medium text-sm btn-secondary"
              >
                <Phone size={16} />
                <span>Call Script</span>
                {showCallScript ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>

            {/* Expandable Call Script */}
            {showCallScript && (
              <div className="mb-4 p-4 bg-white/5 border border-white/10 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-white text-sm">Phone Order Script</h3>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(generateCallScript());
                      setIsCopied(true);
                      setTimeout(() => setIsCopied(false), 2000);
                    }}
                    className="text-xs text-[#ff393a] hover:text-[#ff5a5b]"
                  >
                    Copy script
                  </button>
                </div>
                <pre className="text-xs text-white/70 whitespace-pre-wrap font-mono bg-black/20 p-3 rounded-lg">
                  {generateCallScript()}
                </pre>
              </div>
            )}

            {/* Inline Pizzeria Search/Results */}
            <div className="mb-4 p-4 bg-white/5 border border-white/10 rounded-xl">
              {!hasSearched || pizzerias.length === 0 ? (
                // Show search form if no results yet
                <div className="space-y-3">
                  <h3 className="font-medium text-white text-sm mb-3">Find a Pizzeria</h3>

                  <button
                    onClick={handleUseCurrentLocation}
                    disabled={pizzeriaLoading}
                    className="w-full btn-primary flex items-center justify-center gap-2 text-sm py-2"
                  >
                    {pizzeriaLoading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Navigation size={16} />
                    )}
                    Use My Location
                  </button>

                  <div className="flex items-center gap-2 text-white/40">
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="text-xs">or</span>
                    <div className="flex-1 h-px bg-white/10" />
                  </div>

                  <form onSubmit={handleAddressSearch} className="flex gap-2">
                    <div className="flex-1">
                      <LocationAutocomplete
                        value={searchAddress}
                        onChange={setSearchAddress}
                        placeholder="Enter delivery address..."
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={pizzeriaLoading || !searchAddress.trim()}
                      className="btn-secondary px-3"
                    >
                      {pizzeriaLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                    </button>
                  </form>

                  {pizzeriaError && (
                    <p className="text-xs text-[#ff393a]">{pizzeriaError}</p>
                  )}
                </div>
              ) : (
                // Show top 3 pizzerias
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-white text-sm">Top Pizzerias Nearby</h3>
                    <button
                      onClick={() => setShowPizzeriaSearch(true)}
                      className="text-xs text-[#ff393a] hover:text-[#ff5a5b]"
                    >
                      View all
                    </button>
                  </div>

                  {pizzerias.slice(0, 3).map((pizzeria) => {
                    const directOption = pizzeria.orderingOptions.find(o => supportsDirectOrdering(o.provider) && o.available);
                    const phoneOption = pizzeria.orderingOptions.find(o => o.provider === 'phone');
                    const primaryOption = directOption || phoneOption || pizzeria.orderingOptions[0];

                    return (
                      <div
                        key={pizzeria.id}
                        className="p-3 bg-white/5 border border-white/10 rounded-lg"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-white text-sm truncate">{pizzeria.name}</h4>
                              <div className="flex items-center gap-1">
                                {renderStars(pizzeria.rating)}
                                {pizzeria.reviewCount !== undefined && (
                                  <span className="text-xs text-white/50">({pizzeria.reviewCount})</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-xs text-white/50">
                              {pizzeria.distance && (
                                <span>{formatDistance(pizzeria.distance)}</span>
                              )}
                              {pizzeria.isOpen !== undefined && (
                                <span className={pizzeria.isOpen ? 'text-[#39d98a]' : 'text-[#ff393a]'}>
                                  {pizzeria.isOpen ? 'Open' : 'Closed'}
                                </span>
                              )}
                            </div>
                          </div>

                          {primaryOption && (
                            primaryOption.provider === 'phone' && pizzeria.phone ? (
                              <a
                                href={`tel:${pizzeria.phone}`}
                                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-white bg-white/10 hover:bg-white/20"
                              >
                                <Phone size={12} className="md:hidden" />
                                <span className="md:hidden">Call</span>
                                <span className="hidden md:inline">{pizzeria.phone}</span>
                              </a>
                            ) : supportsDirectOrdering(primaryOption.provider) ? (
                              <button
                                onClick={() => handleInlineSelectPizzeria(pizzeria, primaryOption)}
                                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-white"
                                style={{ backgroundColor: getProviderColor(primaryOption.provider) }}
                              >
                                <ShoppingCart size={12} />
                                Order
                              </button>
                            ) : primaryOption.deepLink ? (
                              <a
                                href={primaryOption.deepLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-white bg-white/10 hover:bg-white/20"
                              >
                                <ExternalLink size={12} />
                                Order
                              </a>
                            ) : null
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
            <PizzeriaSearch
              onSelectPizzeria={handleSelectPizzeria}
              partyAddress={party?.address}
              initialPizzerias={pizzerias}
              initialSearchAddress={searchAddress}
              className="bg-[#1a1a2e] border border-white/10 rounded-2xl p-6"
              initialShowAll={true}
            />
          </div>
        </div>
      )}

      {/* Order Checkout Modal */}
      {selectedPizzeria && selectedOption && (
        <OrderCheckout
          pizzeria={selectedPizzeria}
          orderingOption={selectedOption}
          recommendations={recommendations}
          partyId={party?.id}
          onClose={handleCloseCheckout}
          onOrderComplete={handleOrderComplete}
        />
      )}

      {/* Order Complete Modal */}
      {orderComplete && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl p-6 w-full max-w-md text-center">
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
