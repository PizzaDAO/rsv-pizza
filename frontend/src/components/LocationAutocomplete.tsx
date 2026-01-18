import React, { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const LocationAutocomplete: React.FC<LocationAutocompleteProps> = ({
  value,
  onChange,
  placeholder = 'Add Event Location',
  className = ''
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [autocomplete, setAutocomplete] = useState<google.maps.places.Autocomplete | null>(null);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    // If no API key, fall back to regular text input
    if (!apiKey) {
      setIsLoaded(true);
      return;
    }

    // Load Google Maps script manually
    const loadGoogleMaps = async () => {
      try {
        // Check if already loaded
        if (window.google?.maps?.places) {
          initAutocomplete();
          return;
        }

        // Create script tag
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=Function.prototype`;
        script.async = true;
        script.defer = true;

        script.onload = () => {
          initAutocomplete();
        };

        script.onerror = () => {
          console.error('Error loading Google Maps');
          setIsLoaded(true);
        };

        document.head.appendChild(script);
      } catch (error) {
        console.error('Error loading Google Maps:', error);
        setIsLoaded(true);
      }
    };

    const initAutocomplete = () => {
      if (inputRef.current && window.google?.maps?.places) {
        const autocompleteInstance = new window.google.maps.places.Autocomplete(
          inputRef.current,
          {
            types: ['geocode', 'establishment'],
            fields: ['formatted_address', 'name', 'place_id']
          }
        );

        autocompleteInstance.addListener('place_changed', () => {
          const place = autocompleteInstance.getPlace();
          if (place.formatted_address) {
            onChange(place.formatted_address);
          } else if (place.name) {
            onChange(place.name);
          }
        });

        setAutocomplete(autocompleteInstance);
        setIsLoaded(true);
      }
    };

    loadGoogleMaps();

    return () => {
      if (autocomplete) {
        window.google?.maps?.event?.clearInstanceListeners(autocomplete);
      }
    };
  }, []);

  return (
    <div className="relative">
      <MapPin size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none z-10" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full !pl-11 text-left ${className}`}
      />
    </div>
  );
};
