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
