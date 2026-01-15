# Multi-Wave Pizza Ordering - Complete Implementation Guide

## Overview

Add event timing and multi-wave pizza ordering functionality to RSVPizza. Pizza is best consumed within 45 minutes of delivery, so long parties need multiple delivery waves with intelligent timing and quantity distribution.

## Feature Requirements

### User Story
As a party host, I want to specify the party duration so that the system can automatically calculate optimal pizza delivery waves, ensuring fresh pizza throughout the event.

### Specifications
1. **Duration Input**: Decimal hours (0.5 = 30 min, 1.5 = 1.5 hours, 2.5 = 2.5 hours)
2. **Wave Timing Rules**:
   - First wave arrives **5 minutes BEFORE** party starts
   - First wave weighted **1.25x heavier** (25% more pizza than other waves)
   - No pizza arrives less than **45 minutes before party ends**
   - Waves spaced **45-60 minutes apart**
   - Parties shorter than **1.5 hours** get single wave only
3. **Pizza Distribution**: First wave gets 1.25x more pizza, remaining waves split evenly
4. **Display**: Stacked wave sections showing timing, pizzas, and beverages per wave
5. **Backward Compatibility**: Parties without duration continue working with single-wave display

---

## Phase 1: Database Schema Changes

### 1.1 Update Prisma Schema

**File:** `backend/prisma/schema.prisma`

**Location:** In the `Party` model (around line 30), add the duration field:

```prisma
model Party {
  id                 String    @id @default(cuid())
  name               String
  inviteCode         String    @unique @default(cuid())
  date               DateTime?
  duration           Float?     // ADD THIS: Decimal hours (0.5, 1, 1.5, 2, etc.)
  pizzaSize          String
  pizzaStyle         String
  availableBeverages String[]
  address            String?
  latitude           Float?
  longitude          Float?
  maxGuests          Int?
  rsvpClosedAt       DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  userId             String
  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  guests             Guest[]
  orders             Order[]
}
```

### 1.2 Run Database Migration

**Option A - Using Prisma (Recommended):**
```bash
cd backend
npx prisma migrate dev --name add_party_duration
```

**Option B - Manual SQL (if Prisma doesn't work):**

Create `migration-duration-field.sql`:
```sql
-- Add duration field to parties table
-- Duration is stored as Float (decimal hours: 0.5, 1, 1.5, 2, etc.)
ALTER TABLE parties ADD COLUMN IF NOT EXISTS duration FLOAT NULL;
```

Then run in Supabase SQL Editor or via psql.

### 1.3 Verify Migration

```sql
-- Check the column was added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'parties' AND column_name = 'duration';

-- Should return: duration | double precision | YES
```

---

## Phase 2: TypeScript Type Definitions

### 2.1 Update Types File

**File:** `frontend/src/types.ts`

**Add new interfaces** (after existing interfaces, around line 67):

```typescript
export interface Wave {
  id: string;
  arrivalTime: Date;
  guestAllocation: number;
  weight: number;
  label: string;
}

export interface WaveRecommendation {
  wave: Wave;
  pizzas: PizzaRecommendation[];
  beverages: BeverageRecommendation[];
  totalPizzas: number;
  totalBeverages: number;
}
```

**Update Party interface** (around line 89):

```typescript
export interface Party {
  id: string;
  name: string;
  inviteCode: string;
  date: string | null;
  duration: number | null;  // ADD THIS LINE
  hostName: string | null;
  pizzaStyle: string;
  availableBeverages?: string[];
  maxGuests: number | null;
  address: string | null;
  rsvpClosedAt: string | null;
  createdAt: string;
  guests: Guest[];
}
```

---

## Phase 3: Backend API Updates

### 3.1 Update Party Routes

**File:** `backend/src/routes/party.routes.ts`

**Update POST /api/parties endpoint** (around line 29-54):

```typescript
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, date, duration, pizzaSize, pizzaStyle, address, maxGuests, availableBeverages } = req.body;

    if (!name || !pizzaSize || !pizzaStyle) {
      throw new AppError('Name, pizza size, and pizza style are required', 400, 'VALIDATION_ERROR');
    }

    const party = await prisma.party.create({
      data: {
        name,
        date: date ? new Date(date) : null,
        duration: duration || null,  // ADD THIS
        pizzaSize,
        pizzaStyle,
        availableBeverages: availableBeverages || [],
        address,
        maxGuests,
        userId: req.userId!,
      },
    });

    res.status(201).json({ party });
  } catch (error) {
    next(error);
  }
});
```

**Update PATCH /api/parties/:id endpoint** (around line 81-113):

Add `duration` to the destructured request body and update data object:

```typescript
router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, date, duration, pizzaSize, pizzaStyle, address, maxGuests, availableBeverages } = req.body;

    // ... existing ownership verification ...

    const party = await prisma.party.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(date !== undefined && { date: date ? new Date(date) : null }),
        ...(duration !== undefined && { duration }),  // ADD THIS
        ...(pizzaSize && { pizzaSize }),
        ...(pizzaStyle && { pizzaStyle }),
        ...(address !== undefined && { address }),
        ...(maxGuests !== undefined && { maxGuests }),
        ...(availableBeverages !== undefined && { availableBeverages }),
      },
    });

    res.json({ party });
  } catch (error) {
    next(error);
  }
});
```

---

## Phase 4: Frontend Data Layer

### 4.1 Update Supabase Client

**File:** `frontend/src/lib/supabase.ts`

**Update DbParty interface** (around line 9-22):

```typescript
export interface DbParty {
  id: string;
  name: string;
  invite_code: string;
  host_name: string | null;
  date: string | null;
  duration: number | null;  // ADD THIS
  pizza_style: string;
  available_beverages: string[];
  max_guests: number | null;
  address: string | null;
  rsvp_closed_at: string | null;
  created_at: string;
}
```

**Update createParty function** (around line 38-59):

```typescript
export async function createParty(
  name: string,
  hostName?: string,
  date?: string,
  pizzaStyle: string = 'new-york',
  expectedGuests?: number,
  address?: string,
  availableBeverages?: string[],
  duration?: number  // ADD THIS PARAMETER
): Promise<DbParty | null> {
  const { data, error } = await supabase
    .from('parties')
    .insert({
      name,
      host_name: hostName || null,
      date: date || null,
      duration: duration || null,  // ADD THIS
      pizza_style: pizzaStyle,
      available_beverages: availableBeverages || [],
      max_guests: expectedGuests || null,
      address: address || null,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating party:', error);
    return null;
  }
  return data;
}
```

---

## Phase 5: Wave Algorithm Implementation

### 5.1 Create Wave Algorithm File

**File:** `frontend/src/utils/waveAlgorithm.ts` (NEW FILE)

```typescript
import { Wave, WaveRecommendation, Party, Guest, PizzaStyle } from '../types';
import { generatePizzaRecommendations } from './pizzaAlgorithm';
import { generateBeverageRecommendations } from './beverageAlgorithm';
import { availableBeverages } from '../contexts/PizzaContext';

// Constants
const FIRST_WAVE_OFFSET_MINUTES = -5;      // Arrive 5 min before party
const FIRST_WAVE_WEIGHT = 1.25;            // 25% more pizza in first wave
const MIN_TIME_BEFORE_END_MINUTES = 45;    // No pizza less than 45 min before end
const WAVE_SPACING_MIN = 45;               // Minimum spacing between waves
const WAVE_SPACING_MAX = 60;               // Maximum spacing between waves
const SHORT_PARTY_THRESHOLD_HOURS = 1.5;   // Single wave if shorter

interface WaveCalculationParams {
  partyStartTime: Date;
  durationHours: number;
  totalGuests: number;
}

export function calculateWaves(params: WaveCalculationParams): Wave[] {
  const { partyStartTime, durationHours, totalGuests } = params;

  // Edge case: very short party (<1.5 hours) → single wave
  if (durationHours < SHORT_PARTY_THRESHOLD_HOURS) {
    return [{
      id: 'wave-1',
      arrivalTime: new Date(partyStartTime.getTime() + FIRST_WAVE_OFFSET_MINUTES * 60000),
      guestAllocation: totalGuests,
      weight: 1.0,  // No overweighting for single wave
      label: 'Single Wave'
    }];
  }

  // Calculate time window for deliveries
  const firstWaveTime = new Date(partyStartTime.getTime() + FIRST_WAVE_OFFSET_MINUTES * 60000);
  const partyEndTime = new Date(partyStartTime.getTime() + durationHours * 3600000);
  const lastPossibleWaveTime = new Date(partyEndTime.getTime() - MIN_TIME_BEFORE_END_MINUTES * 60000);

  const availableWindowMinutes = (lastPossibleWaveTime.getTime() - firstWaveTime.getTime()) / 60000;

  // Calculate number of waves needed
  // Use optimal spacing of 52.5 minutes (midpoint of 45-60 range)
  const optimalSpacing = (WAVE_SPACING_MIN + WAVE_SPACING_MAX) / 2;
  const maxWaves = Math.floor(availableWindowMinutes / WAVE_SPACING_MIN) + 1;
  const optimalWaves = Math.round(availableWindowMinutes / optimalSpacing) + 1;
  const waveCount = Math.min(maxWaves, Math.max(2, optimalWaves));

  // Calculate actual spacing to fit waves evenly
  const actualSpacing = availableWindowMinutes / (waveCount - 1);

  // Generate waves with guest allocation
  const waves: Wave[] = [];
  const totalWeight = FIRST_WAVE_WEIGHT + (waveCount - 1) * 1.0;

  for (let i = 0; i < waveCount; i++) {
    const waveTime = new Date(firstWaveTime.getTime() + i * actualSpacing * 60000);
    const isFirstWave = i === 0;
    const weight = isFirstWave ? FIRST_WAVE_WEIGHT : 1.0;
    const guestAllocation = Math.round((weight / totalWeight) * totalGuests);

    waves.push({
      id: `wave-${i + 1}`,
      arrivalTime: waveTime,
      guestAllocation,
      weight,
      label: isFirstWave ? 'Wave 1 (Party Start)' : `Wave ${i + 1}`
    });
  }

  // Adjust last wave to ensure we use all guests (rounding errors)
  const allocatedGuests = waves.reduce((sum, w) => sum + w.guestAllocation, 0);
  waves[waves.length - 1].guestAllocation += (totalGuests - allocatedGuests);

  return waves;
}

export function generateWaveRecommendations(
  guests: Guest[],
  style: PizzaStyle,
  party: Party
): WaveRecommendation[] {
  // Backward compatibility: no date/duration → single wave
  if (!party.date || !party.duration) {
    const pizzas = generatePizzaRecommendations(guests, style, party.maxGuests);
    const beverages = party.availableBeverages && party.availableBeverages.length > 0
      ? generateBeverageRecommendations(
          guests,
          party.availableBeverages,
          availableBeverages,
          party.maxGuests
        )
      : [];

    return [{
      wave: {
        id: 'wave-1',
        arrivalTime: new Date(),
        guestAllocation: party.maxGuests || guests.length,
        weight: 1.0,
        label: 'All Pizzas'
      },
      pizzas,
      beverages,
      totalPizzas: pizzas.reduce((sum, p) => sum + (p.quantity || 1), 0),
      totalBeverages: beverages.reduce((sum, b) => sum + b.quantity, 0)
    }];
  }

  // Multi-wave logic
  const partyStartTime = new Date(party.date);
  const totalGuests = party.maxGuests || guests.length;
  const waves = calculateWaves({
    partyStartTime,
    durationHours: party.duration,
    totalGuests
  });

  const waveRecommendations: WaveRecommendation[] = [];

  for (const wave of waves) {
    // Generate pizza recommendations for this wave's guest count
    const wavePizzas = generatePizzaRecommendations(
      guests,
      style,
      wave.guestAllocation
    );

    // Generate beverage recommendations for this wave
    const waveBeverages = party.availableBeverages && party.availableBeverages.length > 0
      ? generateBeverageRecommendations(
          guests,
          party.availableBeverages,
          availableBeverages,
          wave.guestAllocation
        )
      : [];

    waveRecommendations.push({
      wave,
      pizzas: wavePizzas,
      beverages: waveBeverages,
      totalPizzas: wavePizzas.reduce((sum, p) => sum + (p.quantity || 1), 0),
      totalBeverages: waveBeverages.reduce((sum, b) => sum + b.quantity, 0)
    });
  }

  return waveRecommendations;
}
```

**Algorithm Key Points:**
- Wraps existing `generatePizzaRecommendations()` and `generateBeverageRecommendations()`
- Each wave gets a guest allocation based on weight
- Short parties (<1.5 hours) automatically get single wave
- Backward compatible: parties without date/duration return single wave

---

## Phase 6: Context Integration

### 6.1 Update PizzaContext

**File:** `frontend/src/contexts/PizzaContext.tsx`

**Step 1: Update imports** (line 1-6):

```typescript
import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Guest, PizzaRecommendation, Topping, PizzaStyle, PizzaSize, PizzaSettings, Party, Beverage, BeverageRecommendation, WaveRecommendation } from '../types';
import { generatePizzaRecommendations } from '../utils/pizzaAlgorithm';
import { generateBeverageRecommendations } from '../utils/beverageAlgorithm';
import { generateWaveRecommendations } from '../utils/waveAlgorithm';  // ADD THIS
import * as db from '../lib/supabase';
```

**Step 2: Update PizzaContextType interface** (around line 8-34):

```typescript
interface PizzaContextType {
  // Party management
  party: Party | null;
  partyLoading: boolean;
  createParty: (name: string, hostName?: string, date?: string, expectedGuests?: number, address?: string, selectedBeverages?: string[], duration?: number) => Promise<void>;  // ADD duration parameter
  loadParty: (inviteCode: string) => Promise<boolean>;
  clearParty: () => void;
  getInviteLink: () => string;
  getHostLink: () => string;
  updatePartyBeverages: (beverages: string[]) => Promise<void>;
  // Guest management
  guests: Guest[];
  addGuest: (guest: Omit<Guest, 'id'>) => Promise<void>;
  removeGuest: (id: string) => Promise<void>;
  // Recommendations
  recommendations: PizzaRecommendation[];
  generateRecommendations: () => void;
  beverageRecommendations: BeverageRecommendation[];
  waveRecommendations: WaveRecommendation[];  // ADD THIS
  // Static data
  availableToppings: Topping[];
  availableBeverages: Beverage[];
  dietaryOptions: string[];
  pizzaStyles: PizzaStyle[];
  pizzaSizes: PizzaSize[];
  pizzaSettings: PizzaSettings;
  updatePizzaSettings: (settings: PizzaSettings) => void;
}
```

**Step 3: Add waveRecommendations state** (around line 130-135):

```typescript
const [party, setParty] = useState<Party | null>(null);
const [partyLoading, setPartyLoading] = useState(false);
const [guests, setGuests] = useState<Guest[]>([]);
const [recommendations, setRecommendations] = useState<PizzaRecommendation[]>([]);
const [beverageRecommendations, setBeverageRecommendations] = useState<BeverageRecommendation[]>([]);
const [waveRecommendations, setWaveRecommendations] = useState<WaveRecommendation[]>([]);  // ADD THIS
```

**Step 4: Update dbPartyToParty converter** (around line 111-127):

```typescript
function dbPartyToParty(dbParty: db.DbParty, guests: Guest[]): Party {
  return {
    id: dbParty.id,
    name: dbParty.name,
    inviteCode: dbParty.invite_code,
    date: dbParty.date,
    duration: dbParty.duration,  // ADD THIS
    hostName: dbParty.host_name,
    pizzaStyle: dbParty.pizza_style,
    availableBeverages: dbParty.available_beverages || [],
    maxGuests: dbParty.max_guests,
    address: dbParty.address,
    rsvpClosedAt: dbParty.rsvp_closed_at,
    createdAt: dbParty.created_at,
    guests,
  };
}
```

**Step 5: Update createParty function** (around line 164-180):

```typescript
const createParty = async (name: string, hostName?: string, date?: string, expectedGuests?: number, address?: string, selectedBeverages?: string[], duration?: number) => {  // ADD duration parameter
  setPartyLoading(true);
  try {
    const dbParty = await db.createParty(name, hostName, date, pizzaSettings.style.id, expectedGuests, address, selectedBeverages, duration);  // PASS duration
    if (dbParty) {
      const newParty = dbPartyToParty(dbParty, []);
      setParty(newParty);
      setGuests([]);
      localStorage.setItem('rsvpizza_currentPartyCode', dbParty.invite_code);
    }
  } finally {
    setPartyLoading(false);
  }
};
```

**Step 6: Update loadParty function** (around line 182-202):

```typescript
const loadParty = useCallback(async (inviteCode: string): Promise<boolean> => {
  // Clear existing state before loading new party
  setRecommendations([]);
  setBeverageRecommendations([]);
  setWaveRecommendations([]);  // ADD THIS
  setPartyLoading(true);
  try {
    const result = await db.getPartyWithGuests(inviteCode);
    if (result) {
      const partyGuests = result.guests.map(dbGuestToGuest);
      const loadedParty = dbPartyToParty(result.party, partyGuests);
      setParty(loadedParty);
      setGuests(partyGuests);
      localStorage.setItem('rsvpizza_currentPartyCode', inviteCode);
      return true;
    }
    return false;
  } finally {
    setPartyLoading(false);
  }
}, []);
```

**Step 7: Update clearParty function** (around line 204-211):

```typescript
const clearParty = () => {
  localStorage.removeItem('rsvpizza_currentPartyCode');
  setParty(null);
  setGuests([]);
  setRecommendations([]);
  setBeverageRecommendations([]);
  setWaveRecommendations([]);  // ADD THIS
};
```

**Step 8: Replace generateRecommendations function** (around line 274-291):

```typescript
const generateRecommendations = () => {
  if (!party) return;

  // Generate wave-based recommendations (handles both single and multi-wave)
  const waves = generateWaveRecommendations(guests, pizzaSettings.style, party);
  setWaveRecommendations(waves);

  // Also update single recommendations for backward compatibility
  setRecommendations(waves[0]?.pizzas || []);
  setBeverageRecommendations(waves[0]?.beverages || []);
};
```

**Step 9: Update context provider value** (around line 293-316):

```typescript
return (
  <PizzaContext.Provider value={{
    party,
    partyLoading,
    createParty,
    loadParty,
    clearParty,
    getInviteLink,
    getHostLink,
    updatePartyBeverages,
    guests,
    addGuest,
    removeGuest,
    recommendations,
    generateRecommendations,
    beverageRecommendations,
    waveRecommendations,  // ADD THIS
    availableToppings,
    availableBeverages,
    dietaryOptions,
    pizzaStyles,
    pizzaSizes,
    pizzaSettings,
    updatePizzaSettings,
  }}>
    {children}
  </PizzaContext.Provider>
);
```

---

## Phase 7: UI Components

### 7.1 Add Duration Input to Party Creation

**File:** `frontend/src/components/PartyHeader.tsx`

**Step 1: Add duration state** (around line 11-17):

```typescript
// Form state
const [partyName, setPartyName] = useState('');
const [hostName, setHostName] = useState('');
const [partyDate, setPartyDate] = useState('');
const [partyDuration, setPartyDuration] = useState('');  // ADD THIS
const [expectedGuests, setExpectedGuests] = useState('');
const [partyAddress, setPartyAddress] = useState('');
```

**Step 2: Update handleCreate function** (around line 21-38):

```typescript
const handleCreate = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!partyName.trim()) return;
  setCreating(true);
  const guestCount = expectedGuests ? parseInt(expectedGuests, 10) : undefined;
  const duration = partyDuration ? parseFloat(partyDuration) : undefined;  // ADD THIS
  await createParty(partyName.trim(), hostName.trim() || undefined, partyDate || undefined, guestCount, partyAddress.trim() || undefined, [], duration);  // PASS duration
  setCreating(false);
  setShowCreateModal(false);
  setShowShareModal(true);
  // Reset form
  setPartyName('');
  setHostName('');
  setPartyDate('');
  setPartyDuration('');  // ADD THIS
  setExpectedGuests('');
  setPartyAddress('');
};
```

**Step 3: Add duration input field in form** (around line 157-187):

After the party date input, add:

```typescript
<div>
  <label className="block text-sm font-medium text-white/80 mb-2">
    <Calendar size={14} className="inline mr-1" />
    Party Duration (hours)
  </label>
  <input
    type="number"
    step="0.5"
    min="0.5"
    max="12"
    value={partyDuration}
    onChange={(e) => setPartyDuration(e.target.value)}
    placeholder="e.g., 2.5"
    className="w-full"
  />
  <p className="text-xs text-white/50 mt-1">
    Duration in decimal hours (0.5 = 30 min, 2.5 = 2½ hours). For multi-wave ordering.
  </p>
</div>
```

### 7.2 Update Pizza Order Summary with Wave Display

**File:** `frontend/src/components/PizzaOrderSummary.tsx`

**Step 1: Install date-fns** (if not already installed):

```bash
cd frontend
npm install date-fns
```

**Step 2: Update imports** (around line 1-17):

```typescript
import React, { useState, useEffect } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { PizzaCard } from './PizzaCard';
import { PizzeriaSearch } from './PizzeriaSearch';
import { OrderCheckout } from './OrderCheckout';
import { Pizzeria, OrderingOption } from '../types';
import { ClipboardList, Share2, Check, ShoppingCart, X, ExternalLink, MapPin, Search, Star, Phone, Loader2, Navigation, Clock, ChevronDown, ChevronUp, Beer } from 'lucide-react';
import { format } from 'date-fns';  // ADD THIS
import {
  searchPizzerias,
  getCurrentLocation,
  geocodeAddress,
  formatDistance,
  getProviderName,
  getProviderColor,
  supportsDirectOrdering,
} from '../lib/ordering';
```

**Step 3: Update usePizza hook** (around line 19):

```typescript
const { recommendations, beverageRecommendations, waveRecommendations, party, guests } = usePizza();  // ADD waveRecommendations
```

**Step 4: Add wave copy functions** (after handleCopyOrder, around line 177):

```typescript
const handleCopyWave = (waveIndex: number) => {
  const waveRec = waveRecommendations[waveIndex];
  if (!waveRec) return;

  const pizzaText = waveRec.pizzas
    .sort((a, b) => (b.quantity || 1) - (a.quantity || 1))
    .map(pizza => {
      const qty = pizza.quantity || 1;
      const toppingsText = pizza.toppings.map(t => t.name).join(', ');
      const label = pizza.label || toppingsText;
      return `${qty}x ${label} (${pizza.size.diameter}" ${pizza.style.name})`;
    })
    .join('\n');

  const beverageText = waveRec.beverages.length > 0
    ? '\n\nBEVERAGES:\n' + waveRec.beverages.map(b => `${b.quantity}x ${b.beverage.name}`).join('\n')
    : '';

  const arrivalTime = format(waveRec.wave.arrivalTime, 'MMMM d, yyyy \'at\' h:mm a');
  const fullText = `${waveRec.wave.label.toUpperCase()}\nArrival: ${arrivalTime}\nGuests: ${waveRec.wave.guestAllocation}\n\nPIZZAS:\n${pizzaText}${beverageText}`;

  navigator.clipboard.writeText(fullText)
    .then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    })
    .catch(err => console.error('Failed to copy:', err));
};

const handleCopyAllWaves = () => {
  const allWavesText = waveRecommendations.map((waveRec, index) => {
    const pizzaText = waveRec.pizzas
      .sort((a, b) => (b.quantity || 1) - (a.quantity || 1))
      .map(pizza => {
        const qty = pizza.quantity || 1;
        const toppingsText = pizza.toppings.map(t => t.name).join(', ');
        const label = pizza.label || toppingsText;
        return `  ${qty}x ${label} (${pizza.size.diameter}" ${pizza.style.name})`;
      })
      .join('\n');

    const beverageText = waveRec.beverages.length > 0
      ? '\n  BEVERAGES:\n' + waveRec.beverages.map(b => `  ${b.quantity}x ${b.beverage.name}`).join('\n')
      : '';

    const arrivalTime = format(waveRec.wave.arrivalTime, 'h:mm a');
    return `=== ${waveRec.wave.label} (${arrivalTime}) ===\nGuests: ${waveRec.wave.guestAllocation}\n${pizzaText}${beverageText}`;
  }).join('\n\n');

  const header = `MULTI-WAVE PIZZA ORDER\nParty: ${party?.name || 'Pizza Party'}\nTotal Guests: ${party?.maxGuests || guests.length}\n\n`;

  navigator.clipboard.writeText(header + allWavesText)
    .then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    })
    .catch(err => console.error('Failed to copy:', err));
};
```

**Step 5: Update generateCallScript function** (around line 116-149):

Replace the entire function:

```typescript
const generateCallScript = () => {
  if (waveRecommendations.length === 0) return '';

  // Single wave mode
  if (waveRecommendations.length === 1) {
    const sortedPizzas = [...waveRecommendations[0].pizzas].sort((a, b) => (b.quantity || 1) - (a.quantity || 1));
    const pizzaLines = sortedPizzas.map(pizza => {
      const qty = pizza.quantity || 1;
      const size = pizza.size.name;
      const dietary = pizza.dietaryRestrictions?.length > 0
        ? ` (${pizza.dietaryRestrictions.join(', ')})`
        : '';

      if (pizza.isHalfAndHalf && pizza.leftHalf && pizza.rightHalf) {
        const leftToppings = pizza.leftHalf.toppings.map(t => t.name).join(', ') || 'cheese';
        const rightToppings = pizza.rightHalf.toppings.map(t => t.name).join(', ') || 'cheese';
        return `  - ${qty}x ${size} pizza, half ${leftToppings} and half ${rightToppings}${dietary}`;
      }

      const toppingsText = pizza.toppings.map(t => t.name).join(', ');
      return `  - ${qty}x ${size} pizza with ${toppingsText || 'cheese'}${dietary}`;
    }).join('\n');

    const totalPizzas = waveRecommendations[0].totalPizzas;
    const deliveryAddress = party?.address || '[YOUR ADDRESS]';

    return `Hi, I'd like to place an order for delivery.

I need ${totalPizzas} pizza${totalPizzas !== 1 ? 's' : ''}:
${pizzaLines}

Delivery address: ${deliveryAddress}

Can you give me the total and estimated delivery time?`;
  }

  // Multi-wave mode
  const waveScripts = waveRecommendations.map(waveRec => {
    const arrivalTime = format(waveRec.wave.arrivalTime, 'h:mm a');
    const pizzaLines = waveRec.pizzas
      .sort((a, b) => (b.quantity || 1) - (a.quantity || 1))
      .map(pizza => {
        const qty = pizza.quantity || 1;
        const size = pizza.size.name;
        const toppingsText = pizza.toppings.map(t => t.name).join(', ');
        const label = pizza.label || toppingsText;
        return `  - ${qty}x ${size} ${label}`;
      })
      .join('\n');

    return `${waveRec.wave.label} (arrive at ${arrivalTime}):\n${pizzaLines}`;
  }).join('\n\n');

  const deliveryAddress = party?.address || '[YOUR ADDRESS]';

  return `Hi, I'd like to place a multi-wave delivery order:

${waveScripts}

Delivery address: ${deliveryAddress}

Can you accommodate these delivery times? Please confirm total and timing.`;
};
```

**Step 6: Replace pizza grid section** (around line 231-278):

Replace the existing pizza grid and beverage section with conditional wave display:

```typescript
{waveRecommendations.length > 1 ? (
  // Multi-wave display
  <div className="space-y-4 mb-4">
    {waveRecommendations.map((waveRec, waveIndex) => (
      <div
        key={waveRec.wave.id}
        className="border border-white/20 rounded-xl p-4 bg-white/5"
      >
        {/* Wave Header */}
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-white/10">
          <div>
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Clock size={16} />
              {waveRec.wave.label}
            </h3>
            <p className="text-sm text-white/60 mt-1">
              Arrive at {format(waveRec.wave.arrivalTime, 'h:mm a')} •{' '}
              {waveRec.totalPizzas} pizza{waveRec.totalPizzas !== 1 ? 's' : ''} for ~{waveRec.wave.guestAllocation} guest{waveRec.wave.guestAllocation !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => handleCopyWave(waveIndex)}
            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
          >
            <Share2 size={14} />
            Copy Wave
          </button>
        </div>

        {/* Pizza Grid */}
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          {waveRec.pizzas.map((pizza, pizzaIndex) => (
            <PizzaCard key={pizza.id} pizza={pizza} index={pizzaIndex} compact />
          ))}
        </div>

        {/* Beverage Section */}
        {waveRec.beverages.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <h4 className="text-sm font-medium text-blue-400 mb-2 flex items-center gap-1">
              <Beer size={14} />
              Beverages ({waveRec.totalBeverages})
            </h4>
            <div className="space-y-1">
              {waveRec.beverages.map(bev => (
                <div key={bev.id} className="flex justify-between text-xs text-white/70">
                  <span>{bev.beverage.name}</span>
                  <span className="font-semibold text-blue-400">{bev.quantity}x</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    ))}

    {/* Copy All Waves Button */}
    <button
      onClick={handleCopyAllWaves}
      className="w-full btn-secondary flex items-center justify-center gap-2"
    >
      <Share2 size={16} />
      Copy All Waves
    </button>
  </div>
) : (
  // Single wave display (existing grid)
  <>
    <div className="grid grid-cols-3 gap-1.5 mb-4">
      {[...recommendations]
        .sort((a, b) => (b.quantity || 1) - (a.quantity || 1))
        .map((pizza, index) => (
        <PizzaCard key={pizza.id} pizza={pizza} index={index} compact />
      ))}
    </div>

    {/* Beverage Order Section */}
    {beverageRecommendations.length > 0 && (
      <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
        <h3 className="font-medium text-blue-400 mb-3 flex items-center gap-2">
          <Beer size={16} />
          Beverage Order
        </h3>
        <div className="space-y-1 text-sm mb-3">
          <p className="text-white/80">
            <span className="text-white/60">Total beverages:</span>{' '}
            <span className="font-semibold text-white text-base">
              {beverageRecommendations.reduce((acc, rec) => acc + rec.quantity, 0)}
            </span>
          </p>
        </div>
        <div className="space-y-2">
          {beverageRecommendations.map(rec => (
            <div
              key={rec.id}
              className="p-2 bg-white/5 border border-white/10 rounded-lg"
            >
              <div className="flex justify-between items-center">
                <div>
                  <span className="font-medium text-white text-sm">{rec.beverage.name}</span>
                  <span className="text-white/50 text-xs ml-2">
                    ({rec.guestCount} {rec.guestCount === 1 ? 'guest' : 'guests'})
                  </span>
                </div>
                <span className="text-blue-400 font-bold text-sm">
                  {rec.quantity}x
                </span>
              </div>
              {rec.isForNonRespondents && (
                <p className="text-xs text-white/40 mt-1">For non-respondents</p>
              )}
            </div>
          ))}
        </div>
      </div>
    )}
  </>
)}
```

---

## Phase 8: Testing

### 8.1 Manual Testing Checklist

**Party Creation:**
- [ ] Create party with duration (e.g., 2.5 hours)
- [ ] Duration saves to database
- [ ] Create party without duration (backward compatibility)

**Wave Calculation:**
- [ ] Short party (1 hour) → 1 wave
- [ ] Standard party (3 hours, 20 guests) → 3-4 waves
- [ ] Long party (6 hours) → 6-7 waves
- [ ] First wave arrives 5 min before start
- [ ] Last wave arrives >45 min before end
- [ ] First wave has ~25% more pizzas
- [ ] Guest allocations sum to total

**UI Display:**
- [ ] Multi-wave stacked sections show correctly
- [ ] Wave times formatted properly (e.g., "3:00 PM")
- [ ] Pizza cards render in each wave
- [ ] Beverage sections show per wave
- [ ] Copy individual wave works
- [ ] Copy all waves works
- [ ] Call script generates multi-wave format

**Edge Cases:**
- [ ] Party without date/duration shows single wave
- [ ] Update existing party to add duration
- [ ] Change duration after guests RSVP'd
- [ ] Very short party (1 hour) → single wave
- [ ] Very long party (8 hours) → many waves
- [ ] Zero or invalid duration → fallback to single wave

### 8.2 Database Verification

```sql
-- Check duration field exists
SELECT id, name, date, duration FROM parties LIMIT 5;

-- Check wave calculation for specific party
SELECT date, duration, max_guests FROM parties WHERE id = 'your-party-id';
```

### 8.3 Test Scenarios

**Scenario 1: Short Party**
- Create party: 1 hour duration, 10 guests
- Expected: Single wave, all pizzas at once

**Scenario 2: Standard Party**
- Create party: 3 hours duration, 20 guests, start time 6:00 PM
- Expected:
  - Wave 1: 5:55 PM (5 min before), ~11 guests, 5-6 pizzas
  - Wave 2: 6:50 PM, ~5 guests, 2-3 pizzas
  - Wave 3: 7:45 PM, ~4 guests, 2 pizzas

**Scenario 3: Long Party**
- Create party: 6 hours duration, 30 guests
- Expected: 6-7 waves, properly spaced

---

## Phase 9: Commit and Deploy

### 9.1 Commit Changes

```bash
git add .
git commit -m "Add multi-wave pizza ordering feature

- Add duration field to Party model
- Implement wave calculation algorithm
- Add wave-based pizza/beverage distribution
- Display stacked wave sections in UI
- Support multi-wave phone order scripts
- Maintain backward compatibility for parties without duration"
```

### 9.2 Push to GitHub

```bash
git push origin master
```

### 9.3 Deploy to Production

Ensure database migration runs in production environment:

```bash
# Via Supabase dashboard or CLI
ALTER TABLE parties ADD COLUMN IF NOT EXISTS duration FLOAT NULL;
```

---

## Summary

This implementation adds intelligent multi-wave pizza ordering to RSVPizza, ensuring fresh pizza throughout long parties. The feature:

- ✅ Automatically calculates optimal delivery timing
- ✅ Weights first wave 25% heavier
- ✅ Ensures no pizza arrives too close to party end
- ✅ Displays clear wave sections with timing
- ✅ Supports phone ordering with multi-wave scripts
- ✅ Maintains backward compatibility

**Files Modified:**
- Backend: `schema.prisma`, `party.routes.ts`
- Frontend Data: `types.ts`, `supabase.ts`, `PizzaContext.tsx`
- Frontend UI: `PartyHeader.tsx`, `PizzaOrderSummary.tsx`
- New File: `waveAlgorithm.ts`

**Total Lines Changed:** ~400 lines
**New Files:** 1 (waveAlgorithm.ts)
**Database Changes:** 1 column (duration)
