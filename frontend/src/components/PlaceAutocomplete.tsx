import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { Pizzeria } from '../types';
import { uuid } from '../lib/utils';

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
  const [isLoaded, setIsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const onPlaceSelectedRef = useRef(onPlaceSelected);

  useEffect(() => {
    onPlaceSelectedRef.current = onPlaceSelected;
  }, [onPlaceSelected]);

  useEffect(() => {
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

  return (
    <div className="relative">
      <MapPin
        size={18}
        className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none z-10"
      />
      {loading && (
        <Loader2
          size={16}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 animate-spin z-10"
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
