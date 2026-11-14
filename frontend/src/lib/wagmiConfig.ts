import { createConfig, http } from 'wagmi';
import { mainnet, base } from 'wagmi/chains';
import { defineChain } from 'viem';
import { getDefaultConfig } from 'connectkit';
import { BRAND } from '../config/brand';
import { walletConnectors } from './wallet/connectors';

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Monadscan', url: 'https://monadscan.com' },
  },
});

// No WalletConnect / Reown project ID: wallets connect through injected (EIP-6963),
// the MetaMask SDK and Coinbase Wallet (see ./wallet/connectors). VITE_WALLETCONNECT_PROJECT_ID
// is intentionally ignored, so the app behaves the same whether it is set or not.
// Use the page origin (not BRAND.url) so brand subdomains and previews identify as themselves.
const appOrigin = typeof window !== 'undefined' ? window.location.origin : BRAND.url;
const appIcon = /^https?:\/\//.test(BRAND.logoUrl) ? BRAND.logoUrl : `${appOrigin}${BRAND.logoUrl.startsWith('/') ? '' : '/'}${BRAND.logoUrl}`;

export const wagmiConfig = createConfig(
  getDefaultConfig({
    chains: [mainnet, base, monad],
    transports: {
      [mainnet.id]: http(),
      [base.id]: http(),
      [monad.id]: http('https://rpc.monad.xyz'),
    },
    walletConnectProjectId: '', // required by the type; unused because connectors are supplied explicitly
    connectors: walletConnectors({ name: BRAND.name, url: appOrigin, icon: appIcon }),
    appName: BRAND.name,
    appDescription: 'Pizza party RSVP and donation platform',
    appUrl: appOrigin,
    enableAaveAccount: false,
  })
);
