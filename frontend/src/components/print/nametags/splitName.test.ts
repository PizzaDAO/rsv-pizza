import { describe, it, expect } from 'vitest';
import { splitName } from './nametagData';

describe('splitName', () => {
  it('splits on the first space', () => {
    expect(splitName('Ada Lovelace')).toEqual({ first: 'Ada', last: 'Lovelace' });
    expect(splitName('Mary Jane van Dyke')).toEqual({ first: 'Mary', last: 'Jane van Dyke' });
    expect(splitName("Zoë O'Brien-Smith")).toEqual({ first: 'Zoë', last: "O'Brien-Smith" });
  });
  it('handles repeated whitespace', () => {
    expect(splitName('  Ada    Lovelace ')).toEqual({ first: 'Ada', last: 'Lovelace' });
  });
  it('does not split single names', () => {
    expect(splitName('Cher')).toBeNull();
    expect(splitName('')).toBeNull();
  });
  it('does not split non-Latin scripts', () => {
    expect(splitName('山田 太郎')).toBeNull();
    expect(splitName('山田太郎')).toBeNull();
    expect(splitName('김 민수')).toBeNull();
    expect(splitName('Мария Иванова')).toBeNull();
    expect(splitName('Ada 山田')).toBeNull();
  });
  it('does not split names with digits or symbols', () => {
    expect(splitName('Agent 47')).toBeNull();
    expect(splitName('DJ @slice')).toBeNull();
  });
});
