import React, { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { isGoogleMaps } from '../lib/maps/provider';
import { IconInput } from './IconInput';
import {
  searchAddresses,
  AddressResult,
  AUTOCOMPLETE_DEBOUNCE_MS,
  AUTOCOMPLETE_MIN_CHARS,
} from '../lib/maps/photonAutocomplete';

export interface CityData {
  cityName: string;      // "New York"
  country: string;       // "United States"
  countryCode: string;   // "US"
  state?: string;        // "NY" (administrative_area_level_1 short_name)
  // prosciutto-92107: structured street + postal code, parsed from Google Places
  // address_components. Tax forms (W-9 / W-8BEN / W-8BEN-E) wire the
  // LocationAutocomplete onto their street-address input and split the
  // returned components into separate City / State / ZIP / Country inputs.
  street?: string;       // "123 Main St" (street_number + route)
  postalCode?: string;   // "94103"
  lat: number;
  lng: number;
  formattedName: string; // "New York, NY, USA"
}

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onVenueNameChange?: (venueName: string | null) => void;
  onTimezoneChange?: (timezone: string) => void;
  onPlaceSelected?: (address: string, venueName: string | null, placeId: string | null) => void;
  onLocationSelected?: (location: { lat: number; lng: number } | null) => void;
  onCitySelected?: (cityData: CityData) => void;
  types?: string[];
  fields?: string[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export const LocationAutocomplete: React.FC<LocationAutocompleteProps> = ({
  value,
  onChange,
  onVenueNameChange,
  onTimezoneChange,
  onPlaceSelected,
  onLocationSelected,
  onCitySelected,
  types,
  fields,
  disabled,
  placeholder = 'Add Event Location',
  className = ''
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [, setIsLoaded] = useState(false);
  const [autocomplete, setAutocomplete] = useState<google.maps.places.Autocomplete | null>(null);
  // napoletana-58547: keyless (`osm`) autocomplete state.
  const [suggestions, setSuggestions] = useState<AddressResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const justSelectedRef = useRef(false);

  // Use refs to avoid stale closures in the event listener
  const onChangeRef = useRef(onChange);
  const onVenueNameChangeRef = useRef(onVenueNameChange);
  const onTimezoneChangeRef = useRef(onTimezoneChange);
  const onPlaceSelectedRef = useRef(onPlaceSelected);
  const onLocationSelectedRef = useRef(onLocationSelected);
  const onCitySelectedRef = useRef(onCitySelected);

  useEffect(() => {
    onChangeRef.current = onChange;
    onVenueNameChangeRef.current = onVenueNameChange;
    onTimezoneChangeRef.current = onTimezoneChange;
    onPlaceSelectedRef.current = onPlaceSelected;
    onLocationSelectedRef.current = onLocationSelected;
    onCitySelectedRef.current = onCitySelected;
  }, [onChange, onVenueNameChange, onTimezoneChange, onPlaceSelected, onLocationSelected, onCitySelected]);

  useEffect(() => {
    // osm provider: skip Google entirely (handled by the search effect below).
    if (!isGoogleMaps()) {
      setIsLoaded(true);
      return;
    }

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
        // Build fields list: use prop if provided, otherwise default
        const defaultFields = ['formatted_address', 'name', 'place_id', 'geometry'];
        let autocompleteFields = fields || defaultFields;
        // If onCitySelected is provided, ensure address_components is in fields
        if (onCitySelectedRef.current && !autocompleteFields.includes('address_components')) {
          autocompleteFields = [...autocompleteFields, 'address_components'];
        }

        const autocompleteInstance = new window.google.maps.places.Autocomplete(
          inputRef.current,
          {
            types: types || ['geocode', 'establishment'],
            fields: autocompleteFields
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

          // Set location coords + fetch timezone BEFORE onPlaceSelected
          // so that callers reading pendingCoordsRef see the value in time
          if (place.geometry?.location) {
            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();
            fetchTimezone(lat, lng);
            if (onLocationSelectedRef.current) {
              onLocationSelectedRef.current({ lat, lng });
            }
          } else if (onLocationSelectedRef.current) {
            onLocationSelectedRef.current(null);
          }

          // Parse city data from address_components.
          // marinara-92106: fire onCitySelected whenever ANY of city OR country
          // is available, not only when city+geometry are both present. Country
          // alone is enough to persist parties.country (74 prod rows had NULL
          // country because the previous guard short-circuited any pick that
          // lacked a locality, e.g. street-only or establishment picks).
          if (onCitySelectedRef.current && place.address_components) {
            const components = place.address_components;
            const getComponent = (type: string) =>
              components.find(c => c.types.includes(type));

            const cityComponent = getComponent('locality') || getComponent('postal_town') || getComponent('sublocality') || getComponent('administrative_area_level_1');
            const countryComponent = getComponent('country');
            const stateComponent = getComponent('administrative_area_level_1');
            // prosciutto-92107: street = street_number + route; postal_code
            // optional (not present on every pick — e.g. broad city-level picks).
            const streetNumberComponent = getComponent('street_number');
            const routeComponent = getComponent('route');
            const postalCodeComponent = getComponent('postal_code');
            const street = [streetNumberComponent?.long_name, routeComponent?.long_name]
              .filter((p): p is string => !!p && p.length > 0)
              .join(' ');

            if (cityComponent || countryComponent || street) {
              const lat = place.geometry?.location?.lat();
              const lng = place.geometry?.location?.lng();
              onCitySelectedRef.current({
                cityName: cityComponent?.long_name || '',
                country: countryComponent?.long_name || '',
                countryCode: countryComponent?.short_name || '',
                state: stateComponent?.short_name,
                street: street || undefined,
                postalCode: postalCodeComponent?.long_name || undefined,
                lat: typeof lat === 'number' ? lat : 0,
                lng: typeof lng === 'number' ? lng : 0,
                formattedName: selectedAddress,
              });
            }
          }

          // Call onPlaceSelected LAST — callers may trigger a save here
          // that reads coords set by onLocationSelected above
          if (onPlaceSelectedRef.current && selectedAddress) {
            onPlaceSelectedRef.current(selectedAddress, selectedVenueName, place.place_id || null);
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

  // ── osm: debounced, abortable keyless search on the controlled `value` ───────
  useEffect(() => {
    if (isGoogleMaps()) return;
    // Suppress the search that would otherwise fire right after a selection
    // (selecting sets `value` to the formatted address).
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }
    const q = value.trim();
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
  }, [value]);

  const handleOsmSelect = (r: AddressResult) => {
    justSelectedRef.current = true;
    setShowDropdown(false);
    setSuggestions([]);

    const selectedAddress = r.formattedName;
    onChangeRef.current(selectedAddress);
    // osm has no reliable distinct "venue name" — leave it to the address.
    onVenueNameChangeRef.current?.(null);
    // Set coords + timezone BEFORE onPlaceSelected (callers may read them).
    if (r.timezone) onTimezoneChangeRef.current?.(r.timezone);
    onLocationSelectedRef.current?.({ lat: r.lat, lng: r.lng });
    onCitySelectedRef.current?.({
      cityName: r.cityName,
      country: r.country,
      countryCode: r.countryCode,
      state: r.state,
      street: r.street,
      postalCode: r.postalCode,
      lat: r.lat,
      lng: r.lng,
      formattedName: selectedAddress,
    });
    // placeId is null under osm (callers already accept null).
    onPlaceSelectedRef.current?.(selectedAddress, null, null);
  };

  if (!isGoogleMaps()) {
    return (
      <div className="relative">
        <IconInput
          icon={MapPin}
          iconSize={18}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => {
            if (suggestions.length > 0) setShowDropdown(true);
          }}
          onBlur={() => {
            // Delay so a click on a suggestion registers first.
            setTimeout(() => setShowDropdown(false), 150);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={`text-left ${className}`}
        />
        {showDropdown && suggestions.length > 0 && (
          <ul className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-theme-stroke bg-theme-header shadow-xl py-1">
            {suggestions.map((s, i) => (
              <li key={`${s.lat},${s.lng},${i}`}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    // onMouseDown (not onClick) so it fires before input blur.
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
      <MapPin size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none z-10" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full !pl-11 text-left ${className}`}
      />
    </div>
  );
};
