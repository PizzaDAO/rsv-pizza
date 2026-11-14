import { injected, metaMask, coinbaseWallet } from 'wagmi/connectors';
import { isMobile } from './handoff';

/** Synchronously ask for EIP-6963 announcements; returns how many wallets answered. */
export function countEip6963Wallets(win: Window | undefined = typeof window !== 'undefined' ? window : undefined): number {
  if (!win) return 0;
  const seen = new Set<string>();
  const onAnnounce = (e: Event) => {
    seen.add((e as CustomEvent).detail?.info?.uuid ?? String(seen.size));
  };
  win.addEventListener('eip6963:announceProvider', onAnnounce);
  win.dispatchEvent(new Event('eip6963:requestProvider'));
  win.removeEventListener('eip6963:announceProvider', onAnnounce);
  return seen.size;
}

/**
 * Generic injected() only as a fallback for older in-app browsers that inject window.ethereum
 * but never announce via EIP-6963. When any EIP-6963 wallet exists it is omitted, so entries
 * are not duplicated.
 */
export function needsLegacyInjected(win: (Window & { ethereum?: unknown }) | undefined = typeof window !== 'undefined' ? window : undefined): boolean {
  return !!win && !!win.ethereum && countEip6963Wallets(win) === 0;
}

/**
 * Connector list that needs no WalletConnect / Reown project ID.
 * - Injected wallets (extensions, in-wallet browsers) come from wagmi's EIP-6963 discovery
 *   (multiInjectedProviderDiscovery, on by default), so there is deliberately no generic
 *   `injected()` entry: it shows as a "Browser Wallet" that fails on mobile Safari and
 *   duplicates the discovered wallets on desktop.
 * - metaMask: MetaMask SDK, desktop only (QR over MetaMask's own relay). On mobile ConnectKit
 *   treats the SDK connector as "not installed" and deep-links to an empty WalletConnect URI,
 *   so mobile users get MetaMask through the OpenInWallet in-app-browser link instead.
 * - coinbaseWallet: Coinbase Wallet SDK incl. Smart Wallet passkeys.
 */
export const walletConnectors = (app: { name: string; url: string; icon: string }) => [
  ...(needsLegacyInjected() ? [injected({ shimDisconnect: true })] : []),
  ...(isMobile()
    ? []
    : [metaMask({ dappMetadata: { name: app.name, url: app.url, iconUrl: app.icon }, enableAnalytics: false })]),
  coinbaseWallet({
    appName: app.name,
    appLogoUrl: app.icon,
    preference: 'all', // EOA + Smart Wallet passkeys
  }),
];
