import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import {
  getHandoffUrl as defaultGetHandoffUrl,
  isMobile,
  hasInjectedProvider,
  walletBrowseLinks,
} from '../lib/wallet/handoff';

interface OpenInWalletProps {
  /** Override how the URL to open is built (defaults to a signed-in hand-off URL or the plain page URL). */
  getHandoffUrl?: () => Promise<string>;
  className?: string;
}

// Handoff tokens live 2 minutes; re-mint a little before that while the buttons are visible.
const REFRESH_MS = 90_000;

/** True once any EIP-6963 wallet has announced itself. */
function useAnnouncedWallets(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const seen = new Set<string>();
    const onAnnounce = (e: Event) => {
      const uuid = (e as CustomEvent).detail?.info?.uuid ?? String(seen.size);
      if (!seen.has(uuid)) {
        seen.add(uuid);
        setCount(seen.size);
      }
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
  }, []);
  return count;
}

/**
 * "Open this page in your wallet app" buttons. Rendered only on a mobile browser that has no
 * wallet injected (i.e. not already inside a wallet's in-app browser).
 *
 * The URL is minted ahead of time (on mount and refreshed), not on tap, so the tap navigates
 * synchronously; iOS universal links can fall back to Safari/App Store after an `await`.
 */
export function OpenInWallet({ getHandoffUrl = defaultGetHandoffUrl, className = '' }: OpenInWalletProps) {
  const announced = useAnnouncedWallets();
  const eligible = useMemo(() => isMobile() && !hasInjectedProvider() && announced === 0, [announced]);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const getter = useRef(getHandoffUrl);
  useEffect(() => { getter.current = getHandoffUrl; });

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    const mint = () => {
      if (document.visibilityState === 'hidden') return;
      getter.current().then(
        (u) => { if (!cancelled) setUrl(u); },
        () => { if (!cancelled) setUrl(window.location.href); },
      );
    };
    mint();
    const id = window.setInterval(mint, REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [eligible]);

  if (!eligible) return null;

  const links = url ? walletBrowseLinks(url) : [];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className={`bg-theme-surface rounded-xl p-3 border border-theme-stroke ${className}`} data-testid="open-in-wallet">
      <p className="text-theme-text-secondary text-xs mb-2">Open this page in your wallet app</p>
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <a
            key={l.id}
            href={l.href}
            data-fallback={l.fallbackHref}
            onClick={l.fallbackHref ? () => {
              // If the universal link is swallowed (page stays visible), try the app scheme.
              const fallback = l.fallbackHref!;
              window.setTimeout(() => {
                if (document.visibilityState === 'visible') window.location.href = fallback;
              }, 1500);
            } : undefined}
            className="px-3 py-2 min-h-[40px] rounded-xl bg-theme-surface-hover border border-theme-stroke text-theme-text text-sm flex items-center"
          >
            {l.name}
          </a>
        ))}
        {!url && <span className="text-theme-text-muted text-xs">Preparing links...</span>}
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="mt-2 text-xs text-theme-text-muted hover:text-theme-text flex items-center gap-1"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Link copied' : 'Copy link to open in your wallet browser'}
      </button>
    </div>
  );
}
