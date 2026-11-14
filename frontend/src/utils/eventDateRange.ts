/**
 * Event date range for the public event page. Same-day (or no end) events keep the existing long
 * date; multi-day events (e.g. hackathons) show "Thu, Apr 1 – Sat, Apr 3, 2027". Day boundaries are
 * evaluated in the event timezone.
 */
export function formatEventDateRange(
  start: Date,
  end: Date | null,
  timezone?: string | null,
  locale?: string,
): { dateLine: string; multiDay: boolean } {
  const tz = timezone || undefined;
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const longDate = start.toLocaleDateString(locale, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz,
  });
  if (!end || Number.isNaN(end.getTime()) || dayKey(end) === dayKey(start)) {
    return { dateLine: longDate, multiDay: false };
  }
  const short = (d: Date, withYear: boolean) =>
    d.toLocaleDateString(locale, {
      weekday: 'short', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: tz,
    });
  const yr = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', timeZone: tz });
  return {
    dateLine: `${short(start, yr(start) !== yr(end))} – ${short(end, true)}`,
    multiDay: true,
  };
}
