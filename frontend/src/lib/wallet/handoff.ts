/**
 * Wallet hand-off helpers (shared "wallet connect without WalletConnect" module).
 * Pure functions, no React, so they can be copied to other sites as-is.
 */

export interface WalletBrowseLink {
  id: 'metamask' | 'coinbase' | 'trust' | 'rainbow' | 'phantom';
  name: string;
  /** Universal link (https). */
  href: string;
  /** Custom-scheme fallback for when the universal link is intercepted. */
  fallbackHref?: string;
}

/** True on phones and tablets (iPadOS reports a desktop Mac UA, so also check touch). */
export function isMobile(
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints: number = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0,
): boolean {
  if (/Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && maxTouchPoints > 1;
}

/** Sync check for an injected provider (`window.ethereum`, or a Phantom EVM provider). */
export function hasInjectedProvider(
  win: { ethereum?: unknown; phantom?: { ethereum?: unknown } } | undefined = typeof window !== 'undefined' ? window : undefined,
): boolean {
  if (!win) return false;
  return !!(win.ethereum || win.phantom?.ethereum);
}

/** Should the "Open in your wallet" buttons show? Mobile browser with no wallet injected. */
export function shouldOfferWalletLinks(announcedCount = 0): boolean {
  return isMobile() && !hasInjectedProvider() && announcedCount === 0;
}

const enc = encodeURIComponent;

/**
 * Deep links that open `url` inside each wallet's in-app browser.
 * `url` must be an absolute https URL (use window.location.origin, never a brand constant).
 */
export function walletBrowseLinks(url: string): WalletBrowseLink[] {
  const u = new URL(url);
  const origin = u.origin;
  // MetaMask wants host+path+query with no scheme, appended after /dapp/.
  const noScheme = `${u.host}${u.pathname}${u.search}${u.hash}`;
  return [
    {
      id: 'metamask',
      name: 'MetaMask',
      href: `https://link.metamask.io/dapp/${noScheme}`,
    },
    {
      id: 'coinbase',
      name: 'Coinbase Wallet',
      href: `https://go.cb-w.com/dapp?cb_url=${enc(url)}`,
      fallbackHref: `cbwallet://dapp?url=${enc(url)}`,
    },
    {
      id: 'trust',
      name: 'Trust Wallet',
      // coin_id=60 (Ethereum) is required for the injected EVM provider.
      href: `https://link.trustwallet.com/open_url?coin_id=60&url=${enc(url)}`,
    },
    {
      id: 'rainbow',
      name: 'Rainbow',
      href: `https://rnbwapp.com/dapp?url=${enc(url)}`,
      fallbackHref: `rainbow://dapp?url=${enc(url)}`,
    },
    {
      id: 'phantom',
      name: 'Phantom',
      href: `https://phantom.com/ul/browse/${enc(url)}?ref=${enc(origin)}`,
    },
  ];
}

/**
 * Accept only same-site local paths ("/x", "/x?y=1"). Rejects "//host", schemes,
 * backslashes and control characters, so it can't become an open redirect.
 */
export function sanitizeNextPath(next: string | null | undefined): string | null {
  if (!next || typeof next !== 'string') return null;
  if (!next.startsWith('/')) return null;
  if (next.startsWith('//') || next.startsWith('/\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
  if (next.length > 2048) return null;
  return next;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3006';

/**
 * Build the URL to open in a wallet's browser. Signed-in users get a 2-minute single-use
 * sign-in token appended (POST /api/auth/handoff); guests and any failure fall back to
 * the plain current URL, so RSVPs still work without login.
 */
export async function getHandoffUrl(): Promise<string> {
  const plain = window.location.href;
  let authToken: string | null = null;
  try {
    authToken = localStorage.getItem('authToken');
  } catch {
    /* storage blocked */
  }
  if (!authToken) return plain;
  try {
    const res = await fetch(`${API_URL}/api/auth/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ next: window.location.pathname + window.location.search }),
    });
    if (!res.ok) return plain;
    const data = await res.json();
    if (typeof data?.token !== 'string') return plain;
    // Built from window.location.origin so brand subdomains and previews stay on their own host.
    const params = new URLSearchParams({ token: data.token });
    const next = sanitizeNextPath(window.location.pathname + window.location.search);
    if (next) params.set('next', next);
    return `${window.location.origin}/auth/verify?${params.toString()}`;
  } catch {
    return plain;
  }
}
