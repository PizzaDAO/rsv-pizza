import { createContext } from 'react';

/** True inside a mounted wallet provider, so nested gates don't re-wrap. Kept in its own tiny module so the heavy WalletProviders chunk never imports WalletGate. */
export const WalletInsideContext = createContext(false);
