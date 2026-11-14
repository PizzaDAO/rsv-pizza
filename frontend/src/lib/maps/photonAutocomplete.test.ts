import { describe, expect, it } from 'vitest';
import { dedupeByLabel, type AddressResult } from './photonAutocomplete';

const r = (formattedName: string, lat: number) => ({ formattedName, lat } as unknown as AddressResult);

describe('dedupeByLabel', () => {
  it('keeps the first result per label (city + same-named county)', () => {
    const out = dedupeByLabel([
      r('Philadelphia, Pennsylvania, United States', 39.95),
      r('Philadelphia, Pennsylvania, United States', 40.01),
      r('Philadelphia, Faiyum, Egypt', 29.4),
    ]);
    expect(out.map((x) => x.formattedName)).toEqual([
      'Philadelphia, Pennsylvania, United States',
      'Philadelphia, Faiyum, Egypt',
    ]);
    expect(out[0].lat).toBe(39.95);
  });
});
