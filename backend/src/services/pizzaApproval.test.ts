import { describe, it, expect, vi } from 'vitest';
import { confirmationIdOf, withApprovalHold, holdUntilOf } from './pizzaApproval.js';

const hold = '2026-11-14T22:03:00.000Z';
const na = { type: 'open_url', url: 'https://api.openpizza.xyz/confirm/lconf_Ab-1_z', expires_at: '2026-11-14T22:30:00.000Z', message: 'm' };

describe('pizza-mcp 64fb2ac: the price approval hold', () => {
  it('finds the confirmation id only in an open_url to /confirm/lconf_*', () => {
    expect(confirmationIdOf(na)).toBe('lconf_Ab-1_z');
    expect(confirmationIdOf({ ...na, url: 'https://x/confirm/lconf_a?x=1' })).toBe('lconf_a');
    expect(confirmationIdOf({ ...na, url: 'https://x/confirm/conf_a' })).toBeNull(); // native confirmations have no hold
    expect(confirmationIdOf({ ...na, url: 'https://x/confirm/lconf_a/../../admin' })).toBeNull();
    expect(confirmationIdOf({ ...na, type: 'none' })).toBeNull();
    expect(confirmationIdOf(null)).toBeNull();
  });

  it('adds hold_until and live for a price approval, leaves everything else alone', async () => {
    const getConfirmation = vi.fn(async (id: string) => ({ id, kind: 'price_increase' as const, hold_until: hold, live: true }));
    const out = await withApprovalHold({ getConfirmation }, { status: 'awaiting_price_approval', next_action: na } as any);
    expect(out.next_action).toEqual({ ...na, hold_until: hold, live: true });
    expect(getConfirmation).toHaveBeenCalledWith('lconf_Ab-1_z');
    const first = { status: 'awaiting_approval', next_action: na } as any;
    expect(await withApprovalHold({ getConfirmation }, first)).toBe(first);
    expect(getConfirmation).toHaveBeenCalledTimes(1);
  });

  it('a thrown or mismatched view changes nothing', async () => {
    const o = { status: 'awaiting_price_approval', next_action: na } as any;
    expect(await withApprovalHold({ getConfirmation: async () => { throw new Error('down'); } }, o)).toBe(o);
    expect(await withApprovalHold({ getConfirmation: async () => ({ id: 'lconf_x', kind: 'price_increase', hold_until: hold }) }, o)).toBe(o);
    const noHold = await withApprovalHold({ getConfirmation: async () => ({ id: 'lconf_Ab-1_z', kind: 'price_increase' as const, hold_until: null, live: false }) }, o);
    expect(noHold.next_action).toMatchObject({ hold_until: null, live: false });
  });

  it('holdUntilOf reads the stored hold only while the price approval waits', () => {
    expect(holdUntilOf({ status: 'awaiting_price_approval', nextAction: { ...na, hold_until: hold } })).toBe(hold);
    expect(holdUntilOf({ status: 'calling', nextAction: { ...na, hold_until: hold } })).toBeNull();
    expect(holdUntilOf({ status: 'awaiting_price_approval', nextAction: na })).toBeNull();
    expect(holdUntilOf({ status: 'awaiting_price_approval', nextAction: { hold_until: 'tomorrow' } })).toBeNull();
  });
});
