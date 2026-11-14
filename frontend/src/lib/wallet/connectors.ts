import { metaMask, coinbaseWallet } from 'wagmi/connectors';
import { isMobile } from './handoff';

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
  ...(isMobile()
    ? []
    : [metaMask({ dappMetadata: { name: app.name, url: app.url, iconUrl: app.icon }, enableAnalytics: false })]),
  coinbaseWallet({
    appName: app.name,
    appLogoUrl: app.icon,
    preference: 'all', // EOA + Smart Wallet passkeys
  }),
];
