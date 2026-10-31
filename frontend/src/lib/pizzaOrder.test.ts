import { describe, it, expect } from 'vitest';
import type { PizzaRecommendation } from '../types';
import { shopBadge, toE164, statusInfo, defaultPickupLocal, isTerminalStatus, toRecommendationPayload, formatCents } from './pizzaOrder';

describe('shopBadge', () => {
  it('maps the ordering channel to the plan badges', () => {
    expect(shopBadge({ tier: 'native', ordering: { channel: 'api', call_countries_ok: true, reasons: [] } })).toMatchObject({ label: 'Orders instantly', orderable: true });
    expect(shopBadge({ tier: 'listing', ordering: { channel: 'ai_phone', call_countries_ok: true, reasons: [] } })).toMatchObject({ label: 'AI calls for you, pay at pickup', orderable: true });
    expect(shopBadge({ tier: 'listing', ordering: { channel: 'handoff', call_countries_ok: false, reasons: [] } })).toMatchObject({ label: 'Call it yourself', orderable: false });
  });
  it('is not orderable when the channel is unknown on a listing', () => {
    expect(shopBadge({ tier: 'listing' }).orderable).toBe(false);
  });
});

describe('toE164', () => {
  it('normalises US numbers and passes through valid E.164', () => {
    expect(toE164('(617) 555-0123')).toBe('+16175550123');
    expect(toE164('1 617 555 0123')).toBe('+16175550123');
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
  });
  it('rejects junk', () => {
    expect(toE164('555-0123')).toBeNull();
    expect(toE164('')).toBeNull();
  });
});

describe('statusInfo', () => {
  it('uses the shop total and ready time when confirmed', () => {
    const s = statusInfo({ status: 'confirmed_by_shop', shopName: "Sal's", confirmedTotalCents: 18740, readyAtText: 'about 6:30', call: null });
    expect(s.tone).toBe('success');
    expect(s.detail).toContain('$187.40');
    expect(s.detail).toContain('about 6:30');
  });
  it('asks for action on a higher quote', () => {
    expect(statusInfo({ status: 'awaiting_price_approval', shopName: "Sal's", confirmedTotalCents: null, readyAtText: null, call: { shop_total_cents: 24000 } })).toMatchObject({ tone: 'action' });
  });
  it('knows terminal statuses', () => {
    expect(isTerminalStatus('confirmed_by_shop')).toBe(true);
    expect(isTerminalStatus('calling')).toBe(false);
  });
});

describe('defaultPickupLocal', () => {
  it('is 45 min before a party that is far enough away, else 2h from now', () => {
    const now = new Date('2026-11-01T10:00:00');
    expect(defaultPickupLocal('2026-11-01T18:00:00', now)).toBe('2026-11-01T17:15');
    expect(defaultPickupLocal('2026-11-01T11:00:00', now)).toBe('2026-11-01T12:00');
    expect(defaultPickupLocal(null, now)).toBe('2026-11-01T12:00');
  });
});

describe('toRecommendationPayload', () => {
  it('sends only the facts the backend needs (no guest data)', () => {
    const out = toRecommendationPayload([
      { id: 'r1', quantity: 2, size: { diameter: 16, name: 'Large', servings: 4 }, style: { id: 'ny', name: 'New York', description: '' }, toppings: [{ id: 't', name: 'Pepperoni', type: 'meat' }], guestCount: 3, guests: [{ name: 'Secret Guest' }], dietaryRestrictions: ['vegan'] } as unknown as PizzaRecommendation,
    ]);
    expect(JSON.stringify(out)).not.toContain('Secret Guest');
    expect(out[0]).toMatchObject({ id: 'r1', quantity: 2, toppings: [{ name: 'Pepperoni' }], dietaryRestrictions: ['vegan'] });
  });
  it('formats cents', () => expect(formatCents(1050)).toBe('$10.50'));
});
