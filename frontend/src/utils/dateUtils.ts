/**
 * Date/time formatting utilities
 */

/**
 * Format a date for short display (e.g., "Mon, Jan 15")
 */
export function formatShortDate(date: string | Date): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Format a date for full display (e.g., "Monday, January 15, 2024")
 */
export function formatFullDate(date: string | Date): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a date and time for party display (e.g., "Mon, Jan 15 at 6:00 PM")
 */
export function formatPartyDateTime(date: string | Date): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format time only (e.g., "6:00 PM")
 */
export function formatTime(date: string | Date): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Calculate duration in hours between two dates
 */
export function calculateDurationHours(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

/**
 * Parse a date string and time string into a Date object
 */
export function parseDateAndTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}`);
}

/**
 * Get the user's local timezone abbreviation (e.g., "EST", "PST")
 */
export function getLocalTimezoneAbbreviation(): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' });
    const parts = formatter.formatToParts(new Date());
    const timeZonePart = parts.find(part => part.type === 'timeZoneName');
    return timeZonePart?.value || Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}

/**
 * Get the user's full timezone identifier (e.g., "America/New_York")
 */
export function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Check if a date is in the future
 */
export function isFutureDate(date: string | Date): boolean {
  const d = date instanceof Date ? date : new Date(date);
  return d.getTime() > Date.now();
}

/**
 * Check if a date is today
 */
export function isToday(date: string | Date): boolean {
  const d = date instanceof Date ? date : new Date(date);
  const today = new Date();
  return (
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  );
}

/**
 * Get date and time components as they appear in a specific timezone.
 * Useful for displaying/editing event times in the event's timezone.
 *
 * @param date - The UTC date to convert
 * @param timezone - IANA timezone string (e.g., "America/New_York")
 * @returns Object with date string (YYYY-MM-DD) and time string (HH:MM) in the specified timezone
 */
export function getDateTimeInTimezone(date: Date | string, timezone: string): { dateStr: string; timeStr: string } {
  const d = date instanceof Date ? date : new Date(date);

  // Use Intl.DateTimeFormat to get the date/time parts in the target timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(d);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';

  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  const hour = getPart('hour');
  const minute = getPart('minute');

  return {
    dateStr: `${year}-${month}-${day}`,
    timeStr: `${hour}:${minute}`,
  };
}

/**
 * Parse a date and time string as if they're in a specific timezone, returning a UTC Date.
 * This is the inverse of getDateTimeInTimezone - it takes local date/time in a timezone
 * and converts to UTC.
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param timeStr - Time string in HH:MM format
 * @param timezone - IANA timezone string (e.g., "America/New_York")
 * @returns Date object in UTC
 */
export function parseDateTimeInTimezone(dateStr: string, timeStr: string, timezone: string): Date {
  // Create a date string that we can parse
  const dateTimeStr = `${dateStr}T${timeStr}:00`;

  // Create a date in the local timezone first
  const localDate = new Date(dateTimeStr);

  // Get what this date/time would be in the target timezone
  const targetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Get what the local date looks like in the target timezone
  const localInTarget = targetFormatter.format(localDate);

  // Get what the local date looks like in UTC
  const utcFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const localInUTC = utcFormatter.format(localDate);

  // Calculate the offset between local and target timezones by comparing the formatted strings
  // This is a workaround since JavaScript doesn't have native timezone-aware parsing
  const parseFormatted = (str: string) => {
    const match = str.match(/(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+):(\d+)/);
    if (!match) return 0;
    const [, month, day, year, hour, minute, second] = match;
    return Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  };

  const targetMs = parseFormatted(localInTarget);
  const utcMs = parseFormatted(localInUTC);
  const localOffset = targetMs - utcMs;

  // Now we need to figure out the offset of the target timezone from UTC
  // Create a reference date at the target time
  const refDate = new Date(`${dateStr}T12:00:00Z`); // noon UTC on the target date
  const refInTarget = targetFormatter.format(refDate);
  const refInUTC = utcFormatter.format(refDate);

  const refTargetMs = parseFormatted(refInTarget);
  const refUtcMs = parseFormatted(refInUTC);
  const targetOffset = refTargetMs - refUtcMs;

  // The time the user entered is in the target timezone
  // We need to convert it to UTC
  // If target is UTC-5 (EST), then 6pm EST = 11pm UTC, so we ADD the offset
  const [hours, minutes] = timeStr.split(':').map(Number);
  const targetDate = new Date(`${dateStr}T${timeStr}:00Z`);

  // Subtract the target timezone's offset from UTC to get the actual UTC time
  // targetOffset is positive if target is ahead of UTC (e.g., UTC+5)
  // and negative if behind (e.g., UTC-5)
  return new Date(targetDate.getTime() - targetOffset);
}

/**
 * Format a date relative to now (e.g., "Today", "Tomorrow", "Mon, Jan 15")
 */
export function formatRelativeDate(date: string | Date): string {
  const d = date instanceof Date ? date : new Date(date);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (isToday(d)) {
    return 'Today';
  }

  if (
    d.getDate() === tomorrow.getDate() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getFullYear() === tomorrow.getFullYear()
  ) {
    return 'Tomorrow';
  }

  return formatShortDate(d);
}
