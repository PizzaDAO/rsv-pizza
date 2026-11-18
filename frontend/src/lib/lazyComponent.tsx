import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

/**
 * Code-split a component: the module (and everything it imports, e.g. Stripe.js)
 * is only fetched the first time the component renders. Same props as the original.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyComponent<C extends ComponentType<any>>(
  loader: () => Promise<{ default: C }>,
  fallback: ReactNode = null,
): C {
  const Lazy = lazy(loader);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Wrapped = (props: any) => (
    <Suspense fallback={fallback}>
      <Lazy {...props} />
    </Suspense>
  );
  return Wrapped as unknown as C;
}
