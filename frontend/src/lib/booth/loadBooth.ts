import vendor from './vendor.json';

/** Where the vendored, version-pinned booth lives (same origin; fonts resolve next to it). */
export const BOOTH_BASE = `/vendor/questpass-booth/${vendor.version}/`;

let pending: Promise<void> | null = null;

/**
 * Lazy-load the booth custom elements. Injects a module script that carries Subresource Integrity,
 * so a changed or tampered file fails closed. Call only from BoothPage and BoothTab.
 */
export function loadBooth(): Promise<void> {
  if (typeof customElements !== 'undefined' && customElements.get('questpass-booth')) return Promise.resolve();
  pending ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.type = 'module';
    s.src = `${BOOTH_BASE}questpass-booth.js`;
    s.integrity = vendor.integrity;
    s.crossOrigin = 'anonymous';
    s.onerror = () => {
      pending = null;
      s.remove();
      reject(new Error('The photo booth failed to load.'));
    };
    document.head.appendChild(s);
    customElements.whenDefined('questpass-booth').then(() => resolve());
  });
  return pending;
}
