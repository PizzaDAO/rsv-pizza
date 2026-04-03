import { stripMarkdown } from '../lib/utils';

export interface CalendarEvent {
  title: string;
  startDate: Date;
  endDate: Date;
  timezone: string;
  location: string;
  description: string;
  url: string;
}

/**
 * Format a Date as an ICS-compatible UTC datetime string: YYYYMMDDTHHmmSSZ
 */
function formatICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Escape special characters for ICS text fields.
 * ICS spec requires escaping backslashes, semicolons, commas, and newlines.
 */
function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Fold long ICS lines at 75 octets per RFC 5545.
 * Continuation lines start with a single space.
 */
function foldLine(line: string): string {
  const maxLen = 75;
  if (line.length <= maxLen) return line;

  const parts: string[] = [];
  parts.push(line.slice(0, maxLen));
  let pos = maxLen;
  while (pos < line.length) {
    parts.push(' ' + line.slice(pos, pos + maxLen - 1));
    pos += maxLen - 1;
  }
  return parts.join('\r\n');
}

/**
 * Generate an ICS file string with two VALARM reminders (1 day and 1 hour before).
 */
export function generateICSFile(event: CalendarEvent): string {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@rsv.pizza`;
  const now = formatICSDate(new Date());
  const start = formatICSDate(event.startDate);
  const end = formatICSDate(event.endDate);

  const description = escapeICSText(event.description);
  const summary = escapeICSText(event.title);
  const location = escapeICSText(event.location);
  const url = event.url;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RSV.Pizza//Add to Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    `URL:${url}`,
    'STATUS:CONFIRMED',
    // Reminder: 1 day before
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    'DESCRIPTION:Event tomorrow',
    'END:VALARM',
    // Reminder: 1 hour before
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Event in 1 hour',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldLine).join('\r\n');
}

/**
 * Format a Date as Google Calendar URL parameter: YYYYMMDDTHHmmSS (no Z, always UTC for the /Z suffix).
 */
function formatGoogleDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Generate a Google Calendar event creation URL.
 * Note: Google Calendar URL API does not support custom reminders.
 */
export function generateGoogleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${formatGoogleDate(event.startDate)}/${formatGoogleDate(event.endDate)}`,
    details: event.description + (event.url ? `\n\nRSVP: ${event.url}` : ''),
    location: event.location,
    sprop: `website:${event.url}`,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Generate an Outlook web calendar event creation URL.
 */
export function generateOutlookUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    rru: 'addevent',
    subject: event.title,
    startdt: event.startDate.toISOString(),
    enddt: event.endDate.toISOString(),
    body: event.description + (event.url ? `\n\nRSVP: ${event.url}` : ''),
    location: event.location,
    path: '/calendar/action/compose',
  });

  return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`;
}

/**
 * Download an ICS file by creating a temporary blob URL.
 */
export function downloadICSFile(icsContent: string, filename: string): void {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Build a CalendarEvent from a PublicEvent-like object.
 * Truncates description to ~500 chars after stripping markdown.
 */
export function buildCalendarEvent(event: {
  name: string;
  date: string | null;
  duration: number | null;
  timezone: string | null;
  address: string | null;
  venueName: string | null;
  description: string | null;
  inviteCode: string;
  customUrl: string | null;
}): CalendarEvent | null {
  if (!event.date) return null;

  const startDate = new Date(event.date);
  // Default to 2 hours if no duration
  const durationHours = event.duration || 2;
  const endDate = new Date(startDate.getTime() + durationHours * 3600000);

  // Build location string
  const locationParts: string[] = [];
  if (event.venueName) locationParts.push(event.venueName);
  if (event.address) locationParts.push(event.address);
  const location = locationParts.join(', ');

  // Build description: strip markdown, truncate
  let description = '';
  if (event.description) {
    description = stripMarkdown(event.description);
    if (description.length > 500) {
      description = description.slice(0, 497) + '...';
    }
  }

  // Build event URL
  const slug = event.customUrl || event.inviteCode;
  const url = `https://rsv.pizza/${slug}`;

  return {
    title: event.name,
    startDate,
    endDate,
    timezone: event.timezone || 'UTC',
    location,
    description,
    url,
  };
}
