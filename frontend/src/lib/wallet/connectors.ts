import { injected, metaMask, coinbaseWallet } from 'wagmi/connectors';

/**
 * Connector list that needs no WalletConnect / Reown project ID.
 * - injected: extensions and in-wallet browsers (EIP-6963 discovery is on by default in createConfig)
 * - metaMask: MetaMask SDK (mobile hand-off, desktop QR over MetaMask's own relay)
 * - coinbaseWallet: Coinbase Wallet SDK incl. Smart Wallet passkeys
 */
export const walletConnectors = (app: { name: string; url: string; icon: string }) => [
  injected({ shimDisconnect: true }),
  metaMask({
    dappMetadata: { name: app.name, url: app.url, iconUrl: app.icon },
    enableAnalytics: false,
  }),
  coinbaseWallet({
    appName: app.name,
    appLogoUrl: app.icon,
    preference: 'all', // EOA + Smart Wallet passkeys
  }),
];
