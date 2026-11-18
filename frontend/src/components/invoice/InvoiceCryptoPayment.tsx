import { walletComponent } from '../WalletGate';
import type { InvoiceCryptoPaymentProps } from './InvoiceCryptoPaymentImpl';

// Uses wagmi/ConnectKit: implementation + wallet providers load on demand.
export const InvoiceCryptoPayment = walletComponent<InvoiceCryptoPaymentProps>(() => import('./InvoiceCryptoPaymentImpl'));
