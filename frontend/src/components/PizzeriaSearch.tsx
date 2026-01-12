import React, { useState, useEffect } from 'react';
import { Pizzeria, OrderingOption } from '../types';
import {
  searchPizzerias,
  getCurrentLocation,
  geocodeAddress,
  formatDistance,
  getProviderName,
  getProviderColor,
  supportsDirectOrdering,
} from '../lib/ordering';
import {
  MapPin,
  Search,
  Star,
  Phone,
  ExternalLink,
  Loader2,
  Navigation,
  ShoppingCart,
  Clock,
} from 'lucide-react';

interface PizzeriaSearchProps {
  onSelectPizzeria: (pizzeria: Pizzeria, option: OrderingOption) => void;
  partyAddress?: string | null;
  initialPizzerias?: Pizzeria[];
  initialSearchAddress?: string;
}

export const PizzeriaSearch: React.FC<PizzeriaSearchProps> = ({
  onSelectPizzeria,
  partyAddress,
  initialPizzerias,
  initialSearchAddress
}) => {
  const [pizzerias, setPizzerias] = useState<Pizzeria[]>(initialPizzerias || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchAddress, setSearchAddress] = useState(initialSearchAddress || partyAddress || '');
  const [hasSearched, setHasSearched] = useState(!!initialPizzerias?.length);
  const [autoSearched, setAutoSearched] = useState(!!initialPizzerias?.length);

  // Auto-search if party address is provided and no initial pizzerias
  React.useEffect(() => {
    if (partyAddress && !autoSearched && !initialPizzerias?.length) {
      setAutoSearched(true);
      handleAddressSearchAuto(partyAddress);
    }
  }, [partyAddress]);

  const handleAddressSearchAuto = async (address: string) => {
    setLoading(true);
    setError(null);
    try {
      const location = await geocodeAddress(address);
      if (!location) {
        setError('Could not find that address. Please try a different one.');
        return;
      }
      const results = await searchPizzerias(location.lat, location.lng);
      setPizzerias(results);
      setHasSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search');
    } finally {
      setLoading(false);
    }
  };

  // Search using current location
  const handleUseCurrentLocation = async () => {
    setLoading(true);
    setError(null);
    try {
      const location = await getCurrentLocation();
      const results = await searchPizzerias(location.lat, location.lng);
      setPizzerias(results);
      setHasSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get location');
    } finally {
      setLoading(false);
    }
  };

  // Search using address
  const handleAddressSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchAddress.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const location = await geocodeAddress(searchAddress);
      if (!location) {
        setError('Could not find that address. Please try a different one.');
        return;
      }
      const results = await searchPizzerias(location.lat, location.lng);
      setPizzerias(results);
      setHasSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search');
    } finally {
      setLoading(false);
    }
  };

  // Render star rating
  const renderStars = (rating: number | undefined) => {
    if (!rating) return null;
    const fullStars = Math.floor(rating);
    const hasHalf = rating % 1 >= 0.5;

    return (
      <div className="flex items-center gap-1">
        <Star size={14} className="text-yellow-400 fill-yellow-400" />
        <span className="text-white font-medium">{rating.toFixed(1)}</span>
      </div>
    );
  };

  // Render ordering options
  const renderOrderingOptions = (pizzeria: Pizzeria) => {
    // Separate direct ordering from deep links
    const directOptions = pizzeria.orderingOptions.filter(o => supportsDirectOrdering(o.provider) && o.available);
    const deepLinkOptions = pizzeria.orderingOptions.filter(o => !supportsDirectOrdering(o.provider) && o.provider !== 'phone');
    const phoneOption = pizzeria.orderingOptions.find(o => o.provider === 'phone');

    return (
      <div className="flex flex-wrap gap-2 mt-3">
        {/* Direct ordering buttons (API-enabled) */}
        {directOptions.map((option) => (
          <button
            key={option.provider}
            onClick={() => onSelectPizzeria(pizzeria, option)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-all hover:scale-105"
            style={{ backgroundColor: getProviderColor(option.provider) }}
          >
            <ShoppingCart size={14} />
            {getProviderName(option.provider)}
          </button>
        ))}

        {/* Deep link buttons */}
        {deepLinkOptions.map((option) => (
          <a
            key={option.provider}
            href={option.deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white/90 bg-white/10 hover:bg-white/20 transition-all"
          >
            {getProviderName(option.provider)}
            <ExternalLink size={12} />
          </a>
        ))}

        {/* Phone option */}
        {phoneOption && pizzeria.phone && (
          <a
            href={`tel:${pizzeria.phone}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white/90 bg-white/10 hover:bg-white/20 transition-all"
          >
            <Phone size={14} />
            Call
          </a>
        )}
      </div>
    );
  };

  return (
    <div className="card p-6">
      <h2 className="text-xl font-bold text-white mb-4">Find a Pizzeria</h2>

      {/* Search options */}
      <div className="space-y-4 mb-6">
        {/* Use current location */}
        <button
          onClick={handleUseCurrentLocation}
          disabled={loading}
          className="w-full btn-primary flex items-center justify-center gap-2"
        >
          {loading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Navigation size={18} />
          )}
          Use My Location
        </button>

        <div className="flex items-center gap-3 text-white/40">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-sm">or</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Search by address */}
        <form onSubmit={handleAddressSearch} className="flex gap-2">
          <div className="flex-1 relative">
            <MapPin size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={searchAddress}
              onChange={(e) => setSearchAddress(e.target.value)}
              placeholder="Enter delivery address..."
              className="w-full pl-10"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !searchAddress.trim()}
            className="btn-secondary px-4"
          >
            <Search size={18} />
          </button>
        </form>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 bg-[#ff393a]/10 border border-[#ff393a]/30 rounded-xl text-[#ff393a] text-sm mb-4">
          {error}
        </div>
      )}

      {/* Results */}
      {hasSearched && !loading && pizzerias.length === 0 && (
        <div className="text-center py-8 text-white/50">
          <MapPin size={48} className="mx-auto mb-4 opacity-50" />
          <p>No pizzerias found in this area.</p>
          <p className="text-sm mt-1">Try a different location or increase the search radius.</p>
        </div>
      )}

      {pizzerias.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-white/50 mb-4">
            Found {pizzerias.length} pizzeria{pizzerias.length !== 1 ? 's' : ''} nearby
          </p>

          {pizzerias.map((pizzeria) => (
            <div
              key={pizzeria.id}
              className="border border-white/10 rounded-xl p-4 bg-white/5 hover:bg-white/[0.07] transition-all"
            >
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-white">{pizzeria.name}</h3>
                    {renderStars(pizzeria.rating)}
                    {pizzeria.reviewCount && (
                      <span className="text-white/40 text-sm">({pizzeria.reviewCount})</span>
                    )}
                  </div>
                  <p className="text-sm text-white/60 mt-1">{pizzeria.address}</p>
                  <div className="flex items-center gap-3 mt-2 text-sm">
                    {pizzeria.distance && (
                      <span className="text-white/50">
                        {formatDistance(pizzeria.distance)}
                      </span>
                    )}
                    {pizzeria.isOpen !== undefined && (
                      <span className={`flex items-center gap-1 ${pizzeria.isOpen ? 'text-[#39d98a]' : 'text-[#ff393a]'}`}>
                        <Clock size={12} />
                        {pizzeria.isOpen ? 'Open' : 'Closed'}
                      </span>
                    )}
                    {pizzeria.priceLevel && (
                      <span className="text-white/50">
                        {'$'.repeat(pizzeria.priceLevel)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {renderOrderingOptions(pizzeria)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
