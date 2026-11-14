import { describe, it, expect } from 'vitest';
import { countEip6963Wallets, needsLegacyInjected, walletConnectors } from './connectors';

function fakeWin(opts: { ethereum?: boolean; announce?: number }) {
  const target = new EventTarget();
  target.addEventListener('eip6963:requestProvider', () => {
    for (let i = 0; i < (opts.announce ?? 0); i++) {
      target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: `w${i}` } } }));
    }
  });
  return Object.assign(target, { ethereum: opts.ethereum ? {} : undefined }) as unknown as Window & { ethereum?: unknown };
}

describe('legacy injected fallback', () => {
  it('counts EIP-6963 announcements', () => {
    expect(countEip6963Wallets(fakeWin({ announce: 2 }))).toBe(2);
  });
  it('adds injected only for window.ethereum with no EIP-6963 wallets', () => {
    expect(needsLegacyInjected(fakeWin({ ethereum: true, announce: 0 }))).toBe(true);
    expect(needsLegacyInjected(fakeWin({ ethereum: true, announce: 1 }))).toBe(false);
    expect(needsLegacyInjected(fakeWin({ ethereum: false, announce: 0 }))).toBe(false);
    expect(needsLegacyInjected(undefined)).toBe(false);
  });
});

describe('walletConnectors', () => {
  it('is only Coinbase when no wallet is injected (no MetaMask SDK connector)', () => {
    const list = walletConnectors({ name: 'Test', url: 'https://example.org', icon: 'https://example.org/i.png' });
    expect(list).toHaveLength(1);
  });
});
