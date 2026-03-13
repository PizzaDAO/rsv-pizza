import React, { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';

export interface AddressComponents {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface ShippingAddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onAddressSelected?: (components: AddressComponents) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

// Map common country codes to display names used in the form
const COUNTRY_MAP: Record<string, string> = {
  'US': 'USA',
  'GB': 'United Kingdom',
  'KR': 'South Korea',
  'KP': 'North Korea',
  'AE': 'United Arab Emirates',
  'CZ': 'Czech Republic',
};

export const ShippingAddressAutocomplete: React.FC<ShippingAddressAutocompleteProps> = ({
  value,
  onChange,
  onAddressSelected,
  placeholder = 'Search for address...',
  className = '',
  disabled = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [, setIsLoaded] = useState(false);
  const [autocomplete, setAutocomplete] = useState<google.maps.places.Autocomplete | null>(null);

  // Use refs to avoid stale closures in the event listener
  const onChangeRef = useRef(onChange);
  const onAddressSelectedRef = useRef(onAddressSelected);

  useEffect(() => {
    onChangeRef.current = onChange;
    onAddressSelectedRef.current = onAddressSelected;
  }, [onChange, onAddressSelected]);

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
          console.error('Error loading Google Maps');
          setIsLoaded(true);
        };

        document.head.appendChild(script);
      } catch (error) {
        console.error('Error loading Google Maps:', error);
        setIsLoaded(true);
      }
    };

    const extractAddressComponents = (place: google.maps.places.PlaceResult): AddressComponents => {
      const components: AddressComponents = {
        addressLine1: '',
        city: '',
        state: '',
        postalCode: '',
        country: '',
      };

      if (!place.address_components) {
        return components;
      }

      let streetNumber = '';
      let route = '';

      // Use individual if statements (not else-if) so each component type
      // is checked independently — prevents skipping country when a
      // component carries multiple types
      for (const component of place.address_components) {
        const types = component.types;

        if (types.includes('street_number')) {
          streetNumber = component.long_name;
        }
        if (types.includes('route')) {
          route = component.long_name;
        }
        if (types.includes('locality') || types.includes('postal_town')) {
          components.city = component.long_name;
        }
        if (types.includes('administrative_area_level_1')) {
          components.state = component.short_name;
        }
        if (types.includes('postal_code')) {
          components.postalCode = component.long_name;
        }
        if (types.includes('country')) {
          // Map country code to display name matching the form's country list
          const countryCode = component.short_name;
          components.country = COUNTRY_MAP[countryCode] || component.long_name;
        }
      }

      // Combine street number and route for address line 1
      if (streetNumber && route) {
        components.addressLine1 = `${streetNumber} ${route}`;
      } else if (route) {
        components.addressLine1 = route;
      } else if (place.name && !place.name.includes(',')) {
        // If no street address but there's a place name (not a full address), use it
        components.addressLine1 = place.name;
      }

      return components;
    };

    const initAutocomplete = () => {
      if (inputRef.current && window.google?.maps?.places) {
        const autocompleteInstance = new window.google.maps.places.Autocomplete(
          inputRef.current,
          {
            types: ['address'],
            fields: ['formatted_address', 'name', 'address_components', 'geometry']
          }
        );

        autocompleteInstance.addListener('place_changed', () => {
          const place = autocompleteInstance.getPlace();

          // Extract address components
          const components = extractAddressComponents(place);

          // Update the input with address line 1
          if (components.addressLine1) {
            onChangeRef.current(components.addressLine1);
          }

          // Call the callback with all components
          if (onAddressSelectedRef.current) {
            onAddressSelectedRef.current(components);
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
      <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none z-10" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] disabled:opacity-50 !pl-9 ${className}`}
      />
    </div>
  );
};
