// Heavy wallet stack (wagmi + ConnectKit + viem). Only ever imported dynamically
// through WalletGate so it stays out of the entry bundle. Do not import anything
// shared with WalletGate here: the bundler would hoist it into this heavy chunk.
import type { ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { ConnectKitProvider } from 'connectkit';
import { wagmiConfig } from '../lib/wagmiConfig';

export default function WalletProviders({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <ConnectKitProvider theme="midnight">{children}</ConnectKitProvider>
    </WagmiProvider>
  );
}
