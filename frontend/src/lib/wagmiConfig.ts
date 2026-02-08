import { createConfig, http } from 'wagmi';
import { mainnet, base } from 'wagmi/chains';
import { getDefaultConfig } from 'connectkit';

// WalletConnect project ID - get one at https://cloud.reown.com/
const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';

export const wagmiConfig = createConfig(
  getDefaultConfig({
    chains: [mainnet, base],
    transports: {
      [mainnet.id]: http(),
      [base.id]: http(),
    },
    walletConnectProjectId,
    appName: 'RSV.Pizza',
    appDescription: 'Pizza party RSVP and donation platform',
    appUrl: 'https://rsv.pizza',
  })
);
