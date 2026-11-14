import { describe, it, expect, afterEach, vi } from 'vitest';
import { isMobile, hasInjectedProvider, walletBrowseLinks, sanitizeNextPath, getHandoffUrl } from './handoff';

describe('isMobile', () => {
  it('detects iPhone, Android and iPadOS-as-Mac', () => {
    expect(isMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari', 5)).toBe(true);
    expect(isMobile('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari', 5)).toBe(true);
    expect(isMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Safari', 5)).toBe(true);
  });
  it('is false on desktop', () => {
    expect(isMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Safari', 0)).toBe(false);
    expect(isMobile('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari', 0)).toBe(false);
  });
});

describe('hasInjectedProvider', () => {
  it('sees window.ethereum and Phantom EVM', () => {
    expect(hasInjectedProvider({})).toBe(false);
    expect(hasInjectedProvider({ ethereum: {} })).toBe(true);
    expect(hasInjectedProvider({ phantom: { ethereum: {} } })).toBe(true);
  });
});

describe('walletBrowseLinks', () => {
  const url = 'https://monad.rsv.pizza/e/my party?token=a+b&next=%2Fx#h';
  const links = Object.fromEntries(walletBrowseLinks(url).map((l) => [l.id, l]));

  it('MetaMask: scheme-less host+path+query', () => {
    expect(links.metamask.href).toBe('https://link.metamask.io/dapp/monad.rsv.pizza/e/my%20party?token=a+b&next=%2Fx#h');
  });
  it('Coinbase: encoded cb_url plus cbwallet fallback', () => {
    expect(links.coinbase.href).toBe(`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`);
    expect(links.coinbase.fallbackHref).toBe(`cbwallet://dapp?url=${encodeURIComponent(url)}`);
  });
  it('Trust: coin_id=60 and encoded url', () => {
    expect(links.trust.href).toBe(`https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}`);
  });
  it('Rainbow: rnbwapp universal link plus rainbow:// fallback', () => {
    expect(links.rainbow.href).toBe(`https://rnbwapp.com/dapp?url=${encodeURIComponent(url)}`);
    expect(links.rainbow.fallbackHref).toBe(`rainbow://dapp?url=${encodeURIComponent(url)}`);
  });
  it('Phantom: encoded url in path and encoded origin as ref', () => {
    expect(links.phantom.href).toBe(
      `https://phantom.com/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent('https://monad.rsv.pizza')}`,
    );
  });
  it('encodes ampersands so the inner query survives', () => {
    const l = walletBrowseLinks('https://rsv.pizza/auth/verify?token=abc&next=%2Fe%2Fx');
    const cb = new URL(l.find((x) => x.id === 'coinbase')!.href).searchParams.get('cb_url');
    expect(cb).toBe('https://rsv.pizza/auth/verify?token=abc&next=%2Fe%2Fx');
  });
});

describe('sanitizeNextPath', () => {
  it('accepts local paths', () => {
    expect(sanitizeNextPath('/')).toBe('/');
    expect(sanitizeNextPath('/e/party?x=1#y')).toBe('/e/party?x=1#y');
  });
  it('rejects open-redirect shapes', () => {
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', 'evil', '', null, undefined, '/a\nb', '/a\\b']) {
      expect(sanitizeNextPath(bad as string | null | undefined)).toBeNull();
    }
  });
});

describe('getHandoffUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('returns the plain URL for guests without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await getHandoffUrl()).toBe(window.location.href);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds an /auth/verify URL on the current origin when signed in', async () => {
    localStorage.setItem('authToken', 'jwt');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ token: 'tok123' }) })));
    const out = new URL(await getHandoffUrl());
    expect(out.origin).toBe(window.location.origin);
    expect(out.pathname).toBe('/auth/verify');
    expect(out.searchParams.get('token')).toBe('tok123');
    expect(out.searchParams.get('next')).toBe(window.location.pathname + window.location.search);
  });

  it('falls back to the plain URL when minting fails', async () => {
    localStorage.setItem('authToken', 'jwt');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    expect(await getHandoffUrl()).toBe(window.location.href);
  });
});
