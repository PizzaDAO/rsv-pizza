import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatShortDate,
  formatFullDate,
  formatPartyDateTime,
  formatTime,
  calculateDurationHours,
  parseDateAndTime,
  isFutureDate,
  isToday,
  formatTimeDisplay,
  formatRelativeDate,
  getLocalTimezone,
} from './dateUtils';

describe('formatShortDate', () => {
  it('formats date string to short display', () => {
    const result = formatShortDate('2026-06-15T18:00:00Z');
    // Should contain weekday abbreviation, month abbreviation, and day
    expect(result).toMatch(/\w+,\s+\w+\s+\d+/);
  });

  it('accepts Date object', () => {
    const result = formatShortDate(new Date('2026-01-01T12:00:00Z'));
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatFullDate', () => {
  it('formats date to full display with year', () => {
    const result = formatFullDate('2026-06-15T18:00:00Z');
    expect(result).toContain('2026');
    // Should have full weekday and month names
    expect(result).toMatch(/\w+,\s+\w+\s+\d+,\s+\d{4}/);
  });
});

describe('formatPartyDateTime', () => {
  it('includes date and time', () => {
    const result = formatPartyDateTime('2026-06-15T18:00:00Z');
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(5);
  });
});

describe('formatTime', () => {
  it('formats time only from date', () => {
    const result = formatTime(new Date('2026-06-15T18:00:00Z'));
    expect(result).toBeDefined();
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('calculateDurationHours', () => {
  it('calculates hours between two dates', () => {
    const start = new Date('2026-06-15T14:00:00Z');
    const end = new Date('2026-06-15T18:00:00Z');
    expect(calculateDurationHours(start, end)).toBe(4);
  });

  it('handles fractional hours', () => {
    const start = new Date('2026-06-15T14:00:00Z');
    const end = new Date('2026-06-15T15:30:00Z');
    expect(calculateDurationHours(start, end)).toBe(1.5);
  });

  it('returns 0 for same time', () => {
    const date = new Date('2026-06-15T14:00:00Z');
    expect(calculateDurationHours(date, date)).toBe(0);
  });

  it('returns negative for end before start', () => {
    const start = new Date('2026-06-15T18:00:00Z');
    const end = new Date('2026-06-15T14:00:00Z');
    expect(calculateDurationHours(start, end)).toBe(-4);
  });
});

describe('parseDateAndTime', () => {
  it('combines date and time strings into Date', () => {
    const result = parseDateAndTime('2026-06-15', '18:00');
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2026);
  });
});

describe('isFutureDate', () => {
  it('returns true for future dates', () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    expect(isFutureDate(futureDate)).toBe(true);
  });

  it('returns false for past dates', () => {
    const pastDate = new Date('2020-01-01T00:00:00Z');
    expect(isFutureDate(pastDate)).toBe(false);
  });

  it('accepts string dates', () => {
    expect(isFutureDate('2020-01-01')).toBe(false);
    expect(isFutureDate('2099-01-01')).toBe(true);
  });
});

describe('isToday', () => {
  it('returns true for today', () => {
    expect(isToday(new Date())).toBe(true);
  });

  it('returns false for yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isToday(yesterday)).toBe(false);
  });

  it('returns false for tomorrow', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isToday(tomorrow)).toBe(false);
  });
});

describe('formatTimeDisplay', () => {
  it('converts 24h time to 12h format', () => {
    expect(formatTimeDisplay('13:00')).toBe('1:00 PM');
    expect(formatTimeDisplay('00:00')).toBe('12:00 AM');
    expect(formatTimeDisplay('12:00')).toBe('12:00 PM');
    expect(formatTimeDisplay('23:59')).toBe('11:59 PM');
  });

  it('handles morning times', () => {
    expect(formatTimeDisplay('09:30')).toBe('9:30 AM');
    expect(formatTimeDisplay('06:00')).toBe('6:00 AM');
  });

  it('pads minutes with leading zero', () => {
    expect(formatTimeDisplay('14:05')).toBe('2:05 PM');
    expect(formatTimeDisplay('08:00')).toBe('8:00 AM');
  });

  it('returns empty string for empty input', () => {
    expect(formatTimeDisplay('')).toBe('');
  });
});

describe('formatRelativeDate', () => {
  it('returns "Today" for today', () => {
    expect(formatRelativeDate(new Date())).toBe('Today');
  });

  it('returns "Tomorrow" for tomorrow', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(formatRelativeDate(tomorrow)).toBe('Tomorrow');
  });

  it('returns formatted date for other dates', () => {
    // Pick a date far in the future to avoid "Today" or "Tomorrow"
    const futureDate = new Date('2026-12-25T12:00:00');
    const result = formatRelativeDate(futureDate);
    expect(result).not.toBe('Today');
    expect(result).not.toBe('Tomorrow');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('getLocalTimezone', () => {
  it('returns a valid IANA timezone string', () => {
    const tz = getLocalTimezone();
    expect(tz).toBeDefined();
    expect(tz.length).toBeGreaterThan(0);
    // IANA timezones contain a /
    expect(tz).toContain('/');
  });
});
