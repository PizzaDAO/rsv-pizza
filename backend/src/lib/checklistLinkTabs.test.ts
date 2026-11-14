import { describe, it, expect } from 'vitest';
import { isValidLinkTab, isValidSeriesLinkTab } from './checklistLinkTabs.js';

describe('checklist link tab validation', () => {
  it('GPP route list is unchanged', () => {
    expect(isValidLinkTab(null)).toBe(true);
    expect(isValidLinkTab('')).toBe(true);
    expect(isValidLinkTab('partners')).toBe(true);
    expect(isValidLinkTab('attendance')).toBe(false);
    expect(isValidLinkTab('sponsors')).toBe(false);
    expect(isValidLinkTab(42)).toBe(false);
  });

  it('series route also accepts the checklist modal links, nothing else', () => {
    expect(isValidSeriesLinkTab('attendance')).toBe(true);
    expect(isValidSeriesLinkTab('social-post')).toBe(true);
    expect(isValidSeriesLinkTab('photos')).toBe(true);
    expect(isValidSeriesLinkTab(undefined)).toBe(true);
    expect(isValidSeriesLinkTab('sponsors')).toBe(false);
    expect(isValidSeriesLinkTab('javascript:alert(1)')).toBe(false);
    expect(isValidSeriesLinkTab({})).toBe(false);
  });
});
