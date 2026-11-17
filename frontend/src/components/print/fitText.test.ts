import { describe, it, expect } from 'vitest';
import { fitText, splitTwoLines } from './fitText';

const measure = (t: string, s: number) => t.length * s * 0.5;

describe('fitText', () => {
  it('shrinks as the text gets longer, clamped to max/min', () => {
    const w = 200;
    const a = fitText('Al', { maxWidth: w, measure });
    const b = fitText('Alexandria Oc', { maxWidth: w, measure });
    expect(a.size).toBe(40);
    expect(b.size).toBeLessThan(a.size);
    expect(fitText('x'.repeat(500), { maxWidth: w, measure }).size).toBe(14);
  });

  it('wraps to two lines before shrinking below 20pt', () => {
    const r = fitText('Alexandria Ocasio Cortez', { maxWidth: 200, measure });
    expect(r.lines.length).toBe(2);
    expect(r.size).toBeGreaterThanOrEqual(14);
  });

  it('splits at the space nearest the middle, or mid-string for CJK', () => {
    expect(splitTwoLines('Ann Marie Smith')).toEqual(['Ann Marie', 'Smith']);
    expect(splitTwoLines('山田太郎さん')).toEqual(['山田太', '郎さん']);
  });
});
