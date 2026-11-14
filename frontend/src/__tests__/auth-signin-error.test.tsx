/**
 * invite-verify: /api/auth/magic-link answers 429 { error: { message: "... Try again in a
 * few minutes." } } when the per-(email, IP) send budget is used. signIn must surface that
 * message (it used to read only the top-level `message`, so users saw a generic error).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';

afterEach(() => vi.unstubAllGlobals());

function grabAuth() {
  let ctx!: ReturnType<typeof useAuth>;
  function Probe() {
    ctx = useAuth();
    return null;
  }
  render(<AuthProvider><Probe /></AuthProvider>);
  return () => ctx;
}

describe('AuthContext.signIn errors', () => {
  it('shows the API error.message (e.g. the 429 "Try again in a few minutes")', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { code: 'CODE_SEND_LIMIT', message: 'Too many codes requested for this email. Try again in a few minutes.' } }),
    })));
    const auth = grabAuth();
    let err: unknown;
    await act(async () => { err = await auth().signIn('a@b.co').catch((e) => e); });
    expect((err as Error).message).toBe('Too many codes requested for this email. Try again in a few minutes.');
  });

  it('still falls back to a top-level message, then a generic one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ message: 'Bad email' }) })));
    const auth = grabAuth();
    let err: unknown;
    await act(async () => { err = await auth().signIn('x').catch((e) => e); });
    expect((err as Error).message).toBe('Bad email');

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('no json'); } })));
    await act(async () => { err = await auth().signIn('x').catch((e) => e); });
    expect((err as Error).message).toBe('Failed to send magic link');
  });
});
