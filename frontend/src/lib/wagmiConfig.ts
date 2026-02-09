import { createConfig, http } from 'wagmi';
import { mainnet, base } from 'wagmi/chains';
import { defineChain } from 'viem';
import { getDefaultConfig } from 'connectkit';

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

// WalletConnect project ID - get one at https://cloud.reown.com/
const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';

export const wagmiConfig = createConfig(
  getDefaultConfig({
    chains: [mainnet, base, monad],
    transports: {
      [mainnet.id]: http(),
      [base.id]: http(),
      [monad.id]: http('https://rpc.monad.xyz'),
    },
    walletConnectProjectId,
    appName: 'RSV.Pizza',
    appDescription: 'Pizza party RSVP and donation platform',
    appUrl: 'https://rsv.pizza',
  })
);
