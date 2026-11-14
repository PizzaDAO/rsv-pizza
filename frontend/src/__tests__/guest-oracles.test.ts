/**
 * guest-oracles (guests-anon-exposure PR3): /api/preferences is auth-only and self-only,
 * and the public /api/rsvp/:inviteCode/guest/:email lookup has no frontend caller.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({}), channel: () => ({}), removeChannel: () => Promise.resolve() }),
}));

import * as lib from '../lib/supabase';
import { getUserPreferences, saveUserPreferences } from '../lib/supabase';

const PREFS = {
  dietary_restrictions: ['vegan'],
  liked_toppings: [],
  disliked_toppings: [],
  liked_beverages: [],
  disliked_beverages: [],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ preferences: PREFS, success: true }), text: async () => '' }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('preferences require auth', () => {
  it('getUserPreferences returns null without a request when logged out', async () => {
    expect(await getUserPreferences('alice@example.com')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saveUserPreferences returns false without a request when logged out', async () => {
    expect(await saveUserPreferences('alice@example.com', PREFS)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getUserPreferences sends the Bearer token when logged in', async () => {
    localStorage.setItem('authToken', 'tok');
    expect(await getUserPreferences('alice@example.com')).toEqual(PREFS);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/preferences');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('saveUserPreferences sends the Bearer token when logged in', async () => {
    localStorage.setItem('authToken', 'tok');
    expect(await saveUserPreferences('alice@example.com', PREFS)).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
});

describe('no email-keyed guest lookup', () => {
  it('getExistingGuest (public /api/rsvp/:code/guest/:email) is gone', () => {
    expect((lib as Record<string, unknown>).getExistingGuest).toBeUndefined();
  });

  it('nothing in the frontend calls /api/rsvp/:code/guest/:email for reads', () => {
    const src = readFileSync(resolve(__dirname, '../lib/supabase.ts'), 'utf8');
    expect(src).not.toMatch(/\/guest\/\$\{encodeURIComponent\(email\)\}`\)/);
  });
});
