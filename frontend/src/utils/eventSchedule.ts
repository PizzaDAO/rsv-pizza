import { parseDateTimeInTimezone } from './dateUtils';

/** Defaults shown as placeholders in the create form; saved when the host leaves a time empty. */
export const DEFAULT_START_TIME = '12:30';
export const DEFAULT_END_TIME = '13:30';

/**
 * Next end date after the start date input changes. Keeps the end date synced to the start date
 * until the host sets an end date of their own (it differs from the previous start and is not
 * before the new start). Typing a date with the keyboard fires onChange with intermediate years
 * (0002, 0020, 0202, 2026), so "only fill when empty" would freeze the end date at year 0002.
 */
export function nextEndDate(prevStartDate: string, newStartDate: string, endDate: string): string {
  if (!newStartDate) return endDate;
  if (!endDate || endDate === prevStartDate || endDate < newStartDate) return newStartDate;
  return endDate;
}

export interface ScheduleInput {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
}

export type ScheduleError = 'needsStartDate' | 'invalid' | 'endBeforeStart';

export interface ScheduleResult {
  /** ISO start, undefined when the host entered no date at all. */
  startDateTime?: string;
  /** Hours. */
  duration?: number;
  /** Validation error code (mapped to a translated message by the caller); when set, do not submit. */
  error?: ScheduleError;
}

/**
 * Resolve the entered date/time fields into a payload. What the form displays is what is saved:
 * empty times fall back to the placeholder defaults, and a date is never silently dropped.
 */
export function resolveSchedule(input: ScheduleInput): ScheduleResult {
  const { startDate, startTime, endDate, endTime } = input;
  if (!startDate) {
    if (endDate || startTime || endTime) return { error: 'needsStartDate' };
    return {};
  }
  const tz = input.timezone || 'UTC';
  const start = parseDateTimeInTimezone(startDate, startTime || DEFAULT_START_TIME, tz);
  let end: Date;
  if (endTime) {
    end = parseDateTimeInTimezone(endDate || startDate, endTime, tz);
  } else if (startTime) {
    // Host picked a start but no end: default to one hour later (rolls past midnight naturally).
    end = new Date(start.getTime() + 60 * 60 * 1000);
    // If they typed an explicit later end date, keep that date at the same clock time.
    if (endDate && endDate > startDate) end = parseDateTimeInTimezone(endDate, startTime, tz);
  } else {
    end = parseDateTimeInTimezone(endDate || startDate, DEFAULT_END_TIME, tz);
  }
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { error: 'invalid' };
  const durationMs = end.getTime() - start.getTime();
  if (durationMs < 0) return { error: 'endBeforeStart' };
  return { startDateTime: start.toISOString(), duration: durationMs / (1000 * 60 * 60) };
}
