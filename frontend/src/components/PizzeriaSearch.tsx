import React, { useState } from 'react';
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
  X,
  ChevronRight,
} from 'lucide-react';
import { LocationAutocomplete } from './LocationAutocomplete';

interface PizzeriaRanking {
  id: string;
  first: number;
  second: number;
  third: number;
  total: number;
}

interface PizzeriaSearchProps {
  onSelectPizzeria: (pizzeria: Pizzeria, option: OrderingOption) => void;
  partyAddress?: string | null;
  initialPizzerias?: Pizzeria[];
  initialSearchAddress?: string;
  className?: string; // Allow overriding styles (e.g. for modals)
  rankings?: PizzeriaRanking[]; // Guest vote rankings
  initialShowAll?: boolean; // Open the "All Pizzerias" modal immediately
}

export const PizzeriaSearch: React.FC<PizzeriaSearchProps> = ({
  onSelectPizzeria,
  partyAddress,
  initialPizzerias,
  initialSearchAddress,
  className = "card p-6",
  rankings = [],
  initialShowAll = false,
}) => {
  const [pizzerias, setPizzerias] = useState<Pizzeria[]>(initialPizzerias || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchAddress, setSearchAddress] = useState(initialSearchAddress || partyAddress || '');
  const [hasSearched, setHasSearched] = useState(!!initialPizzerias?.length);
  const [autoSearched, setAutoSearched] = useState(!!initialPizzerias?.length);
  const [showAllModal, setShowAllModal] = useState(initialShowAll && !!initialPizzerias?.length);

  const DISPLAY_LIMIT = 3;

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

    return (
      <div className="flex items-center gap-1">
        <Star size={14} className="text-yellow-400 fill-yellow-400" />
        <span className="text-theme-text font-medium">{rating.toFixed(1)}</span>
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-theme-text transition-all hover:scale-105"
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-theme-text bg-theme-surface-hover hover:bg-theme-surface-hover transition-all"
          >
            {getProviderName(option.provider)}
            <ExternalLink size={12} />
          </a>
        ))}

        {/* Phone option */}
        {phoneOption && pizzeria.phone && (
          <a
            href={`tel:${pizzeria.phone}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-theme-text bg-theme-surface-hover hover:bg-theme-surface-hover transition-all"
          >
            <Phone size={14} />
            Call
          </a>
        )}
      </div>
    );
  };

  const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  return (
    <div className={className}>
      <h3 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider mb-3">Top Pizzerias Nearby</h3>

      {/* Search options */}
      <div className="space-y-3 mb-6">
        {/* Use current location - only show if no party address */}
        {!partyAddress && (
          <>
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

            <div className="flex items-center gap-3 text-theme-text-muted">
              <div className="flex-1 h-px bg-theme-surface-hover" />
              <span className="text-sm">or</span>
              <div className="flex-1 h-px bg-theme-surface-hover" />
            </div>
          </>
        )}

        {/* Search by address */}
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
            disabled={loading || !searchAddress.trim()}
            className="btn-secondary px-4"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
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
        <div className="text-center py-8 text-theme-text-muted">
          <MapPin size={48} className="mx-auto mb-4 opacity-50" />
          <p>No pizzerias found in this area.</p>
          <p className="text-sm mt-1">Try a different location or increase the search radius.</p>
        </div>
      )}

      {pizzerias.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-theme-text-muted mb-4">
            Found {pizzerias.length} pizzeria{pizzerias.length !== 1 ? 's' : ''} nearby
          </p>

          {pizzerias.slice(0, DISPLAY_LIMIT).map((pizzeria) => renderPizzeriaCard(pizzeria, googleMapsApiKey, rankings.find(r => r.id === pizzeria.id)))}

          {/* View All Pizzerias button */}
          {pizzerias.length > DISPLAY_LIMIT && (
            <button
              onClick={() => setShowAllModal(true)}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-theme-surface hover:bg-theme-surface-hover border border-theme-stroke rounded-xl text-theme-text hover:text-theme-text transition-all"
            >
              View All {pizzerias.length} Pizzerias
              <ChevronRight size={18} />
            </button>
          )}
        </div>
      )}

      {/* View All Modal */}
      {showAllModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setShowAllModal(false)}
        >
          <div
            className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-theme-stroke">
              <h2 className="text-xl font-bold text-theme-text">All Pizzerias Nearby</h2>
              <button
                onClick={() => setShowAllModal(false)}
                className="p-2 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {pizzerias.map((pizzeria) => renderPizzeriaCard(pizzeria, googleMapsApiKey, rankings.find(r => r.id === pizzeria.id)))}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function renderPizzeriaCard(pizzeria: Pizzeria, apiKey: string | undefined, ranking?: PizzeriaRanking) {
    // Guard against {lat:0, lng:0} from legacy manual entries
    const hasValidCoords = pizzeria.location &&
      !(pizzeria.location.lat === 0 && pizzeria.location.lng === 0);

    const googleMapsUrl = hasValidCoords
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${pizzeria.name} ${pizzeria.address}`)}${pizzeria.placeId ? `&query_place_id=${pizzeria.placeId}` : ''}`
      : null;

    // Construct static map URL (only for valid coords)
    const staticMapUrl = apiKey && hasValidCoords
      ? `https://maps.googleapis.com/maps/api/staticmap?center=${pizzeria.location.lat},${pizzeria.location.lng}&zoom=15&size=200x200&scale=2&markers=color:red%7C${pizzeria.location.lat},${pizzeria.location.lng}&key=${apiKey}`
      : null;

    return (
      <div
        key={pizzeria.id}
        className="border border-theme-stroke rounded-xl p-4 bg-theme-surface hover:bg-theme-surface-hover transition-all"
      >
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {googleMapsUrl ? (
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-theme-text hover:text-[#ff393a] hover:underline flex items-center gap-1"
                >
                  {pizzeria.name}
                  <ExternalLink size={12} className="opacity-50" />
                </a>
              ) : (
                <span className="font-semibold text-theme-text">{pizzeria.name}</span>
              )}
              {renderStars(pizzeria.rating)}
              {pizzeria.reviewCount && (
                <span className="text-theme-text-muted text-sm">({pizzeria.reviewCount})</span>
              )}
              {/* Guest vote badges */}
              {ranking && ranking.total > 0 && (
                <div className="flex items-center gap-1 ml-1">
                  {ranking.first > 0 && (
                    <span className="px-1.5 py-0.5 bg-yellow-400/20 text-yellow-400 rounded text-xs">
                      🥇{ranking.first}
                    </span>
                  )}
                  {ranking.second > 0 && (
                    <span className="px-1.5 py-0.5 bg-gray-300/20 text-gray-300 rounded text-xs">
                      🥈{ranking.second}
                    </span>
                  )}
                  {ranking.third > 0 && (
                    <span className="px-1.5 py-0.5 bg-amber-600/20 text-amber-500 rounded text-xs">
                      🥉{ranking.third}
                    </span>
                  )}
                </div>
              )}
            </div>
            <p className="text-sm text-theme-text-secondary mt-1">{pizzeria.address}</p>
            <div className="flex items-center gap-3 mt-2 text-sm">
              {pizzeria.distance && (
                <span className="text-theme-text-muted">
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
                <span className="text-theme-text-muted">
                  {'$'.repeat(pizzeria.priceLevel)}
                </span>
              )}
            </div>

            {renderOrderingOptions(pizzeria)}
          </div>

          {/* Right side: Map Thumbnail (only if valid coords) */}
          {googleMapsUrl && (
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex flex-col items-center justify-center w-24 h-24 bg-theme-surface-hover rounded-lg border border-theme-stroke flex-shrink-0 hover:bg-theme-surface-hover transition-colors group overflow-hidden relative"
              title="View on Google Maps"
            >
              {staticMapUrl ? (
                <img
                  src={staticMapUrl}
                  alt="Map"
                  className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                />
              ) : (
                <>
                  <MapPin size={24} className="text-[#ff393a] mb-1 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] uppercase font-bold text-theme-text-secondary">View Map</span>
                </>
              )}
            </a>
          )}
        </div>
      </div>
    );
  }
};
