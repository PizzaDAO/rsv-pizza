/**
 * Local wall-clock time -> UTC instant, DST-aware, via Intl (no deps).
 * Copied (generalized to minutes, 1-based month) from the GPP create route; the GPP copies are untouched.
 */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** `month` is 1-12. Returns the UTC Date at which the wall clock in `tz` reads y-m-d hh:mm. */
export function localToUTC(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const fmt = (timeZone: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  const parse = (str: string) => {
    const m = str.match(/(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+):(\d+)/);
    return m ? Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6]) : 0;
  };
  // Offset at the guessed instant, then re-check at the corrected instant (DST boundary).
  const offset1 = parse(fmt(tz).format(utcGuess)) - parse(fmt('UTC').format(utcGuess));
  const first = new Date(utcGuess.getTime() - offset1);
  const offset2 = parse(fmt(tz).format(first)) - parse(fmt('UTC').format(first));
  return offset2 === offset1 ? first : new Date(utcGuess.getTime() - offset2);
}

/** Wall-clock 'HH:MM' of an instant in `tz`. */
export function localHM(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h.padStart(2, '0')}:${m}`;
}
