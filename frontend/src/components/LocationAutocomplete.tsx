import React, { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onVenueNameChange?: (venueName: string | null) => void;
  onTimezoneChange?: (timezone: string) => void;
  onPlaceSelected?: (address: string, venueName: string | null) => void;
  placeholder?: string;
  className?: string;
}

export const LocationAutocomplete: React.FC<LocationAutocompleteProps> = ({
  value,
  onChange,
  onVenueNameChange,
  onTimezoneChange,
  onPlaceSelected,
  placeholder = 'Add Event Location',
  className = ''
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [autocomplete, setAutocomplete] = useState<google.maps.places.Autocomplete | null>(null);

  // Use refs to avoid stale closures in the event listener
  const onChangeRef = useRef(onChange);
  const onVenueNameChangeRef = useRef(onVenueNameChange);
  const onTimezoneChangeRef = useRef(onTimezoneChange);
  const onPlaceSelectedRef = useRef(onPlaceSelected);

  useEffect(() => {
    onChangeRef.current = onChange;
    onVenueNameChangeRef.current = onVenueNameChange;
    onTimezoneChangeRef.current = onTimezoneChange;
    onPlaceSelectedRef.current = onPlaceSelected;
  }, [onChange, onVenueNameChange, onTimezoneChange, onPlaceSelected]);

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

          // Set the address (formatted_address or fallback to name)
          const selectedAddress = place.formatted_address || place.name || '';
          if (selectedAddress) {
            onChangeRef.current(selectedAddress);
          }

          // Set the venue name if it's different from the address (i.e., it's a named place)
          // Only set venue name if it's a named establishment (not just a street address)
          // Check if name exists and is different from the start of formatted_address
          const hasDistinctName = place.name &&
            place.formatted_address &&
            !place.formatted_address.startsWith(place.name);

          const selectedVenueName = hasDistinctName ? place.name : null;

          if (onVenueNameChangeRef.current) {
            onVenueNameChangeRef.current(selectedVenueName);
          }

          // Call onPlaceSelected callback for auto-save
          if (onPlaceSelectedRef.current && selectedAddress) {
            onPlaceSelectedRef.current(selectedAddress, selectedVenueName);
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
