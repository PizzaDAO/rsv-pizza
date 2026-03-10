# GPP City Autocomplete

## Overview

Replace the plain text input for "What city are you hosting in?" on the `/gpp` landing page with Google Maps autocomplete restricted to cities. Reuses the existing `LocationAutocomplete` component with a new `types` prop.

## Approach

Add `types`, `fields`, `onCitySelected`, and `disabled` props to the existing `LocationAutocomplete` component. Pass `types={['(cities)']}` to restrict suggestions to cities only. Parse `address_components` to extract structured city data (city name, country, country code, lat/lng).

No new components needed. No new DB columns needed for MVP.

## Changes

### 1. `frontend/src/components/LocationAutocomplete.tsx`

Add new props and types:

```typescript
export interface CityData {
  cityName: string;      // "New York"
  country: string;       // "United States"
  countryCode: string;   // "US"
  state?: string;        // "NY"
  lat: number;
  lng: number;
  formattedName: string; // "New York, NY, USA"
}

interface LocationAutocompleteProps {
  // ... existing props ...
  onCitySelected?: (cityData: CityData) => void;
  types?: string[];       // defaults to ['geocode', 'establishment']
  fields?: string[];      // defaults to existing fields
  disabled?: boolean;
}
```

- Use `types` prop in `new google.maps.places.Autocomplete()` instead of hardcoded types
- When `onCitySelected` is provided, add `address_components` to fields and parse city/country from result
- Existing behavior unchanged when new props not provided

### 2. `frontend/src/pages/GPPLandingPage.tsx`

Replace plain `<input>` for city with:
```tsx
<LocationAutocomplete
  value={city}
  onChange={setCity}
  onCitySelected={handleCitySelected}
  types={['(cities)']}
  placeholder="e.g., New York, London, Tokyo"
  disabled={isSubmitting}
/>
```

Use `cityData.cityName` (not full formatted address) for submission.

### 3. `frontend/src/lib/api.ts`

Extend `CreateGPPEventData` with optional fields:
```typescript
country?: string;
countryCode?: string;
cityLat?: number;
cityLng?: number;
```

### 4. `backend/src/routes/gpp.routes.ts`

Accept extra fields in destructuring (forward-compatible, not persisted yet):
```typescript
const { city, hostName, email, country, countryCode, cityLat, cityLng } = req.body;
```

## Files to Modify

- `frontend/src/components/LocationAutocomplete.tsx`
- `frontend/src/pages/GPPLandingPage.tsx`
- `frontend/src/lib/api.ts`
- `backend/src/routes/gpp.routes.ts`

## No files to create

## Edge Cases

- If Google Maps API key missing, falls back to plain text input (existing behavior)
- If user types without selecting from dropdown, raw text still submits
- Uses `cityName` for event name, not full formatted address
- Duplicate custom URL slugs are a pre-existing issue (not addressed here)

## Implementation Order

1. Enhance LocationAutocomplete with new props
2. Update GPPLandingPage to use it
3. Extend API types
4. Update backend to accept extra fields
