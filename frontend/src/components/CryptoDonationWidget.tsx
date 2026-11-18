import { walletComponent } from './WalletGate';
import type { CryptoDonationWidgetProps } from './CryptoDonationWidgetImpl';

// Uses wagmi/ConnectKit: implementation + wallet providers load on demand.
export const CryptoDonationWidget = walletComponent<CryptoDonationWidgetProps>(() => import('./CryptoDonationWidgetImpl'));
