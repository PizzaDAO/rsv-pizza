import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { Pizzeria } from '../types';
import { uuid } from '../lib/utils';
import { isGoogleMaps } from '../lib/maps/provider';
import { IconInput } from './IconInput';
import {
  searchAddresses,
  AddressResult,
  AUTOCOMPLETE_DEBOUNCE_MS,
  AUTOCOMPLETE_MIN_CHARS,
} from '../lib/maps/photonAutocomplete';

interface PlaceAutocompleteProps {
  onPlaceSelected: (pizzeria: Partial<Pizzeria>) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export const PlaceAutocomplete: React.FC<PlaceAutocompleteProps> = ({
  onPlaceSelected,
  placeholder = 'Search for a pizzeria...',
  className = '',
  autoFocus = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [, setIsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const onPlaceSelectedRef = useRef(onPlaceSelected);
  // napoletana-58547: keyless (`osm`) autocomplete state.
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AddressResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    onPlaceSelectedRef.current = onPlaceSelected;
  }, [onPlaceSelected]);

  useEffect(() => {
    if (!isGoogleMaps()) {
      setIsLoaded(true);
      return;
    }

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      console.warn('PlaceAutocomplete: VITE_GOOGLE_MAPS_API_KEY is not set');
      setIsLoaded(true);
      return;
    }

    const initAutocomplete = () => {
      if (inputRef.current && window.google?.maps?.places) {
        const autocompleteInstance = new window.google.maps.places.Autocomplete(
          inputRef.current,
          {
            types: ['establishment'],
            fields: [
              'formatted_address',
              'name',
              'place_id',
              'geometry',
              'rating',
              'user_ratings_total',
              'formatted_phone_number',
              'website',
              'price_level',
              'opening_hours',
              'url',
            ],
          }
        );

        autocompleteInstance.addListener('place_changed', () => {
          setLoading(true);
          const place = autocompleteInstance.getPlace();

          if (!place.name) {
            setLoading(false);
            return;
          }

          const lat = place.geometry?.location?.lat() ?? 0;
          const lng = place.geometry?.location?.lng() ?? 0;

          const pizzeria: Partial<Pizzeria> = {
            id: `custom-${uuid()}`,
            placeId: place.place_id || '',
            name: place.name || '',
            address: place.formatted_address || '',
            phone: (place as any).formatted_phone_number || undefined,
            url: place.website || (place as any).url || undefined,
            rating: place.rating || undefined,
            reviewCount: place.user_ratings_total || undefined,
            priceLevel: place.price_level || undefined,
            isOpen: place.opening_hours?.isOpen?.() ?? undefined,
            location: { lat, lng },
            orderingOptions: [],
          };

          onPlaceSelectedRef.current(pizzeria);
          setLoading(false);

          // Clear input after selection
          if (inputRef.current) {
            inputRef.current.value = '';
          }
        });

        autocompleteRef.current = autocompleteInstance;
        setIsLoaded(true);
      }
    };

    const loadGoogleMaps = () => {
      try {
        // Already loaded — init immediately
        if (window.google?.maps?.places) {
          initAutocomplete();
          return;
        }

        // Check if another component already added the script tag
        const existingScript = document.querySelector(
          'script[src*="maps.googleapis.com/maps/api/js"]'
        );

        if (existingScript) {
          // Script tag exists but hasn't finished loading yet — wait for it
          const waitForMaps = () => {
            if (window.google?.maps?.places) {
              initAutocomplete();
            } else {
              setTimeout(waitForMaps, 100);
            }
          };
          waitForMaps();
          return;
        }

        // No script tag exists — create one
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=Function.prototype`;
        script.async = true;
        script.defer = true;

        script.onload = () => {
          initAutocomplete();
        };

        script.onerror = () => {
          console.error('PlaceAutocomplete: Error loading Google Maps script');
          setIsLoaded(true);
        };

        document.head.appendChild(script);
      } catch (error) {
        console.error('PlaceAutocomplete: Error loading Google Maps:', error);
        setIsLoaded(true);
      }
    };

    loadGoogleMaps();

    return () => {
      if (autocompleteRef.current) {
        window.google?.maps?.event?.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, []);

  // ── osm: debounced keyless establishment search ─────────────────────────────
  useEffect(() => {
    if (isGoogleMaps()) return;
    const q = query.trim();
    if (q.length < AUTOCOMPLETE_MIN_CHARS) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const results = await searchAddresses(q, controller.signal);
        setSuggestions(results);
        setShowDropdown(true);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setSuggestions([]);
      }
    }, AUTOCOMPLETE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const handleOsmSelect = (r: AddressResult) => {
    const pizzeria: Partial<Pizzeria> = {
      id: `custom-${uuid()}`,
      placeId: '', // no Google place id under osm
      name: r.name || r.formattedName,
      address: r.formattedName,
      location: { lat: r.lat, lng: r.lng },
      orderingOptions: [],
    };
    onPlaceSelectedRef.current(pizzeria);
    setQuery('');
    setSuggestions([]);
    setShowDropdown(false);
  };

  if (!isGoogleMaps()) {
    return (
      <div className="relative">
        <IconInput
          icon={MapPin}
          iconSize={18}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => {
            if (suggestions.length > 0) setShowDropdown(true);
          }}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={`text-left ${className}`}
        />
        {showDropdown && suggestions.length > 0 && (
          <ul className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-theme-stroke bg-theme-header shadow-xl py-1">
            {suggestions.map((s, i) => (
              <li key={`${s.lat},${s.lng},${i}`}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleOsmSelect(s);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-theme-text hover:bg-theme-surface-hover flex items-start gap-2"
                >
                  <MapPin size={14} className="text-theme-text-muted mt-0.5 flex-shrink-0" />
                  <span className="truncate">{s.formattedName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <MapPin
        size={18}
        className="absolute left-4 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none z-10"
      />
      {loading && (
        <Loader2
          size={16}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted animate-spin z-10"
        />
      )}
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`w-full !pl-11 text-left ${className}`}
      />
    </div>
  );
};
