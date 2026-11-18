import { useEffect, useState } from 'react';
import { walletComponent } from './WalletGate';
import type { RSVPModalProps } from './RSVPModalImpl';

// The modal uses wagmi/ConnectKit, so its implementation and the wallet providers are
// lazy-loaded the first time the modal opens: they stay out of the event page's entry bundle.
const RSVPModalLazy = walletComponent<RSVPModalProps>(
  () => import('./RSVPModalImpl'),
  (props) =>
    props.isOpen ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="status" aria-label="Loading">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    ) : null,
);

export function RSVPModal(props: RSVPModalProps) {
  const [everOpened, setEverOpened] = useState(props.isOpen);
  useEffect(() => {
    if (props.isOpen) setEverOpened(true);
  }, [props.isOpen]);
  if (!props.isOpen && !everOpened) return null;
  return <RSVPModalLazy {...props} />;
}

/** Warm the modal chunk (tests / hover prefetch). */
RSVPModal.preload = RSVPModalLazy.preload;
