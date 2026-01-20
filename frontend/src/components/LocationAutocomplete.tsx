import React, { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onTimezoneChange?: (timezone: string) => void;
  placeholder?: string;
  className?: string;
}

export const LocationAutocomplete: React.FC<LocationAutocompleteProps> = ({
  value,
  onChange,
  onTimezoneChange,
  placeholder = 'Add Event Location',
  className = ''
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [autocomplete, setAutocomplete] = useState<google.maps.places.Autocomplete | null>(null);

  // Use refs to avoid stale closures in the event listener
  const onChangeRef = useRef(onChange);
  const onTimezoneChangeRef = useRef(onTimezoneChange);

  useEffect(() => {
    onChangeRef.current = onChange;
    onTimezoneChangeRef.current = onTimezoneChange;
  }, [onChange, onTimezoneChange]);

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

    const fetchTimezone = async (lat: number, lng: number) => {
      if (!onTimezoneChangeRef.current) return;

      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestamp}&key=${apiKey}`
        );
        const data = await response.json();

        if (data.status === 'OK' && data.timeZoneId) {
          onTimezoneChangeRef.current(data.timeZoneId);
        }
      } catch (error) {
        console.error('Error fetching timezone:', error);
      }
    };

    const initAutocomplete = () => {
      if (inputRef.current && window.google?.maps?.places) {
        const autocompleteInstance = new window.google.maps.places.Autocomplete(
          inputRef.current,
          {
            types: ['geocode', 'establishment'],
            fields: ['formatted_address', 'name', 'place_id', 'geometry']
          }
        );

        autocompleteInstance.addListener('place_changed', () => {
          const place = autocompleteInstance.getPlace();
          if (place.formatted_address) {
            onChangeRef.current(place.formatted_address);
          } else if (place.name) {
            onChangeRef.current(place.name);
          }

          // Fetch timezone based on location coordinates
          if (place.geometry?.location) {
            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();
            fetchTimezone(lat, lng);
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
