import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { walletComponent } from './WalletGate';
import type { RSVPModalProps } from './RSVPModalImpl';

// The modal uses wagmi/ConnectKit, so its implementation and the wallet providers are
// lazy-loaded the first time the modal opens: they stay out of the event page's entry bundle.
const RSVPModalLazy = walletComponent<RSVPModalProps>(
  () => import('./RSVPModalImpl'),
  (props) =>
    props.isOpen ? (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        role="status"
        aria-label="Loading"
        onClick={props.onClose}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={props.onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-white/70 hover:text-white"
        >
          <X size={20} />
        </button>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    ) : null,
);

export function RSVPModal(props: RSVPModalProps) {
  const [everOpened, setEverOpened] = useState(props.isOpen);
  useEffect(() => {
    if (props.isOpen) setEverOpened(true);
  }, [props.isOpen]);
  // Warm the chunk once the browser is idle so the first open is instant.
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => void RSVPModalLazy.preload().catch(() => undefined), { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => void RSVPModalLazy.preload().catch(() => undefined), 2000);
    return () => window.clearTimeout(t);
  }, []);
  if (!props.isOpen && !everOpened) return null;
  return <RSVPModalLazy {...props} />;
}

/** Warm the modal chunk (tests / hover prefetch). */
RSVPModal.preload = RSVPModalLazy.preload;
