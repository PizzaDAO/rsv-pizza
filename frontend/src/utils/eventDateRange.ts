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
  // Minutes after local midnight (event tz) at which the event ends.
  const endMinutes = end && !Number.isNaN(end.getTime())
    ? (() => {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: 'numeric', minute: 'numeric' }).formatToParts(end);
        const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
        return get('hour') * 60 + get('minute');
      })()
    : 0;
  // A range only when the end is on a later local day AND after 06:00: events that run past
  // midnight (a 7pm party ending at 1am) stay single-day; an overnight hackathon ending at 10am shows both days.
  if (
    !end || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime() ||
    dayKey(end) <= dayKey(start) || endMinutes <= 6 * 60
  ) {
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
