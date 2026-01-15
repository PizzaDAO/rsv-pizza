# Wave Feature Refactor Proposal

## Goal
Extract wave ordering feature into separate files to minimize changes to existing code.

## Proposed File Structure

### 1. New Separate Files (No changes to existing files)

```
frontend/src/features/waves/
├── types.ts                    # Wave, WaveRecommendation types
├── waveAlgorithm.ts           # Already created ✓
├── useWaveRecommendations.ts  # Custom hook for wave logic
├── WaveDisplay.tsx            # Wave display UI component
└── DurationInput.tsx          # Duration input field component
```

### 2. Minimal Changes to Existing Files

**PizzaContext.tsx** (reduce to ~10 lines of changes):
```typescript
// Instead of:
// - Adding waveRecommendations state
// - Changing generateRecommendations logic
// - Exporting waveRecommendations

// Do:
import { useWaveRecommendations } from '../features/waves/useWaveRecommendations';

// Then just call the hook and pass through
const waveData = useWaveRecommendations(guests, pizzaSettings, party);
```

**PizzaOrderSummary.tsx** (reduce to ~5 lines of changes):
```typescript
// Instead of: 285 lines of changes with wave display logic inline

// Do: Just import and use the component
import { WaveDisplay } from '../features/waves/WaveDisplay';

// In render:
{waveRecommendations.length > 0 && (
  <WaveDisplay
    waveRecommendations={waveRecommendations}
    party={party}
    guests={guests}
  />
)}
```

**PartyHeader.tsx** (reduce to ~3 lines of changes):
```typescript
// Instead of: 25 lines adding duration input inline

// Do: Just import and use the component
import { DurationInput } from '../features/waves/DurationInput';

// In form:
<DurationInput value={partyDuration} onChange={setPartyDuration} />
```

## Benefits

1. **Isolation**: All wave-specific code in one directory
2. **Easy to remove**: Delete `features/waves/` folder if we want to remove feature
3. **Easy to test**: Each component/hook can be tested independently
4. **Minimal diff**: Existing files show ~20 lines of changes total vs 400+ currently
5. **Clear ownership**: Wave feature code is clearly separated

## Trade-offs

- Slightly more files to navigate
- Need to set up the hook pattern (but cleaner long-term)
- Initial refactor work (~1 hour)

## Implementation Order

1. Create `features/waves/types.ts` - Extract Wave types
2. Create `features/waves/useWaveRecommendations.ts` - Extract logic
3. Create `features/waves/WaveDisplay.tsx` - Extract UI
4. Create `features/waves/DurationInput.tsx` - Extract input
5. Update PizzaContext to use hook
6. Update PizzaOrderSummary to use WaveDisplay
7. Update PartyHeader to use DurationInput
8. Test everything works

## Do you want me to implement this refactor?
