import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
 * "Open this page in your wallet app" panel. Rendered only on a mobile browser that has no
 * wallet injected (i.e. not already inside a wallet's in-app browser).
 *
 * It starts collapsed. Opening it is the first interaction, and that is when a hand-off URL is
 * minted (never on mount). The buttons are plain links so a tap navigates synchronously (iOS
 * universal links can fall back to Safari/App Store after an `await`). Each tap consumes that
 * URL's single-use token, so a fresh one is minted right after every tap, and again whenever the
 * page becomes visible (the user came back from the wallet or a long pause).
 */
export function OpenInWallet({ getHandoffUrl = defaultGetHandoffUrl, className = '' }: OpenInWalletProps) {
  const announced = useAnnouncedWallets();
  const eligible = useMemo(() => isMobile() && !hasInjectedProvider() && announced === 0, [announced]);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const getter = useRef(getHandoffUrl);
  useEffect(() => { getter.current = getHandoffUrl; });
  const fallbackTimer = useRef<number | null>(null);
  const mintSeq = useRef(0);

  const mint = useCallback(() => {
    const seq = ++mintSeq.current;
    getter.current().then(
      (u) => { if (seq === mintSeq.current) setUrl(u); },
      () => { if (seq === mintSeq.current) setUrl(window.location.href); },
    );
  }, []);

  // First interaction: mint when the panel opens. Re-mint when the page becomes visible again.
  useEffect(() => {
    if (!eligible || !open) return;
    mint();
    const onVisible = () => { if (document.visibilityState === 'visible') mint(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [eligible, open, mint]);

  // Never fire the custom-scheme fallback after the page was hidden/left (the app took over).
  useEffect(() => {
    const clear = () => {
      if (fallbackTimer.current) { window.clearTimeout(fallbackTimer.current); fallbackTimer.current = null; }
    };
    const onVis = () => { if (document.visibilityState === 'hidden') clear(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', clear);
    return () => {
      clear();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', clear);
    };
  }, []);

  if (!eligible) return null;

  const links = url ? walletBrowseLinks(url) : [];

  const handleTap = (fallback?: string) => {
    if (fallback) {
      if (fallbackTimer.current) window.clearTimeout(fallbackTimer.current);
      fallbackTimer.current = window.setTimeout(() => {
        fallbackTimer.current = null;
        if (document.visibilityState === 'visible') window.location.href = fallback;
      }, 1500);
    }
    // The token in this URL is now spent. Keep the tapped link rendered (removing it mid-tap can
    // make iOS/Android drop the navigation) and swap in a fresh URL a moment later.
    window.setTimeout(mint, 500);
  };

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
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-theme-text-secondary text-xs w-full text-left"
      >
        Open this page in your wallet app
      </button>
      {open && (
        <>
          <div className="flex flex-wrap gap-2 mt-2">
            {links.map((l) => (
              <a
                key={l.id}
                href={l.href}
                onClick={() => handleTap(l.fallbackHref)}
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
        </>
      )}
    </div>
  );
}
