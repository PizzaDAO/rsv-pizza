import { useContext, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { WalletInsideContext } from './walletContext';

// Lazy loading for the wallet stack (wagmi/ConnectKit/viem, ~900KB).
//
// Any component that uses wagmi hooks or ConnectKit must render inside <WalletGate>, and its
// module must NOT be statically imported from the entry bundle: use walletComponent() so the
// implementation module and the providers are fetched together on first render.
// QueryClientProvider stays global (main.tsx); wagmi picks it up from there.

type ProvidersModule = { default: ComponentType<{ children: ReactNode }> };
let loaded: ProvidersModule | null = null;
let loading: Promise<ProvidersModule> | null = null;

/** Start loading the wallet providers chunk (idempotent). Resolves once it is ready. */
export function preloadWalletProviders(): Promise<ProvidersModule> {
  if (!loading) {
    const p = import('./WalletProviders').then((m) => {
      loaded = m;
      return m;
    });
    // Allow a retry after a failed chunk load (e.g. stale deploy / offline).
    p.catch(() => {
      if (loading === p) loading = null;
    });
    loading = p;
  }
  return loading;
}

export function WalletGate({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const inside = useContext(WalletInsideContext);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (inside || loaded) return;
    let cancelled = false;
    preloadWalletProviders().then(
      () => {
        if (!cancelled) setTick((n) => n + 1);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [inside]);

  if (inside) return <>{children}</>;
  if (!loaded) return <>{fallback}</>;
  const Providers = loaded.default;
  return (
    <Providers>
      <WalletInsideContext.Provider value={true}>{children}</WalletInsideContext.Provider>
    </Providers>
  );
}

/**
 * Wrap a wallet-using component. `loadImpl` is a dynamic import of the module that holds the
 * component (and its wagmi/ConnectKit imports); it is loaded together with the providers the
 * first time the wrapper renders. `preload()` lets tests/pages warm both up front.
 */
export function walletComponent<P extends object>(
  loadImpl: () => Promise<{ default: ComponentType<P> }>,
  fallback: ReactNode | ((props: P) => ReactNode) = null,
): ComponentType<P> & { preload: () => Promise<void> } {
  let Impl: ComponentType<P> | null = null;
  let implLoading: Promise<void> | null = null;

  const preload = () => {
    if (!implLoading) {
      const p = Promise.all([
        loadImpl().then((m) => {
          Impl = m.default;
        }),
        preloadWalletProviders(),
      ]).then(() => undefined);
      p.catch(() => {
        if (implLoading === p) implLoading = null;
      });
      implLoading = p;
    }
    return implLoading;
  };

  const Wrapped = (props: P) => {
    const [, setTick] = useState(0);
    useEffect(() => {
      if (Impl && loaded) return;
      let cancelled = false;
      preload().then(
        () => {
          if (!cancelled) setTick((n) => n + 1);
        },
        () => undefined,
      );
      return () => {
        cancelled = true;
      };
    }, []);

    const fb = typeof fallback === 'function' ? (fallback as (p: P) => ReactNode)(props) : fallback;
    if (!Impl || !loaded) return <>{fb}</>;
    const Loaded = Impl;
    return (
      <WalletGate fallback={fb}>
        <Loaded {...(props as P & React.JSX.IntrinsicAttributes)} />
      </WalletGate>
    );
  };
  return Object.assign(Wrapped, { preload });
}
