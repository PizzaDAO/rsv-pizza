import { walletComponent } from './WalletGate';
import type { NftClaimFormProps } from './NftClaimFormImpl';

// Uses wagmi/ConnectKit: implementation + wallet providers load on demand.
export const NftClaimForm = walletComponent<NftClaimFormProps>(() => import('./NftClaimFormImpl'));
