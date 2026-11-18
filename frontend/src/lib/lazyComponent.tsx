import { Suspense, type ComponentType, type ReactNode } from 'react';
import { lazyWithReload } from './chunkReload';

/**
 * Code-split a component: the module (and everything it imports, e.g. Stripe.js)
 * is only fetched the first time the component renders. Same props as the original.
 * A failed chunk load reloads the page once (see chunkReload).
 */
export function lazyComponent<C extends ComponentType<any>>(
  loader: () => Promise<{ default: C }>,
  fallback: ReactNode = null,
): C {
  const Lazy = lazyWithReload(loader);
  const Wrapped = (props: Record<string, unknown>) => (
    <Suspense fallback={fallback}>
      <Lazy {...(props as any)} />
    </Suspense>
  );
  return Wrapped as unknown as C;
}
