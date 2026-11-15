import { describe, it, expect } from 'vitest';
import { nextEndDate, resolveSchedule, DEFAULT_START_TIME, DEFAULT_END_TIME } from './eventSchedule';

const base = { startDate: '', startTime: '', endDate: '', endTime: '', timezone: 'UTC' };

describe('resolveSchedule', () => {
  it('saves the date at the default times when the host never touched the time pickers', () => {
    const r = resolveSchedule({ ...base, startDate: '2026-12-05', endDate: '2026-12-05' });
    expect(r.error).toBeUndefined();
    expect(r.startDateTime).toBe('2026-12-05T12:30:00.000Z');
    expect(r.duration).toBe(1);
    expect(DEFAULT_START_TIME).toBe('12:30');
    expect(DEFAULT_END_TIME).toBe('13:30');
  });

  it('defaults the end date to the start date', () => {
    const r = resolveSchedule({ ...base, startDate: '2026-12-05' });
    expect(r.startDateTime).toBe('2026-12-05T12:30:00.000Z');
    expect(r.duration).toBe(1);
  });

  it('keeps times the host picked', () => {
    const r = resolveSchedule({ ...base, startDate: '2026-12-05', startTime: '18:00', endDate: '2026-12-05', endTime: '21:00' });
    expect(r.startDateTime).toBe('2026-12-05T18:00:00.000Z');
    expect(r.duration).toBe(3);
  });

  it('returns nothing (no error) when no schedule was entered', () => {
    expect(resolveSchedule(base)).toEqual({});
  });

  it('errors instead of silently dropping times that have no date', () => {
    expect(resolveSchedule({ ...base, startTime: '18:00' }).error).toBeTruthy();
  });

  it('errors when the end is before the start', () => {
    const r = resolveSchedule({ ...base, startDate: '2026-12-05', endDate: '2026-12-04' });
    expect(r.error).toBeTruthy();
    expect(r.startDateTime).toBeUndefined();
    const sameDay = resolveSchedule({ ...base, startDate: '2026-12-05', startTime: '18:00', endDate: '2026-12-05', endTime: '17:00' });
    expect(sameDay.error).toBeTruthy();
  });
});

describe('nextEndDate', () => {
  it('stays synced while the start date is typed through intermediate years', () => {
    let start = '';
    let end = '';
    for (const typed of ['0002-12-05', '0020-12-05', '0202-12-05', '2026-12-05']) {
      end = nextEndDate(start, typed, end);
      start = typed;
    }
    expect(end).toBe('2026-12-05');
  });

  it('does not overwrite an end date the host chose', () => {
    expect(nextEndDate('2026-12-05', '2026-12-06', '2026-12-10')).toBe('2026-12-10');
  });

  it('moves the end date forward when the start passes it', () => {
    expect(nextEndDate('2026-12-05', '2026-12-12', '2026-12-10')).toBe('2026-12-12');
  });

  it('leaves the end date alone when the start is cleared', () => {
    expect(nextEndDate('2026-12-05', '', '2026-12-05')).toBe('2026-12-05');
  });
});
