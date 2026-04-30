import { useEffect } from 'react';

/**
 * ConnectKit v1.9.2 does not expose a locale-override API, so we use a
 * MutationObserver on the portal container (#__CONNECTKIT__) to replace
 * hard-coded English strings with MetaMask-specific wording.
 *
 * Render this component once, anywhere inside the React tree.
 */

const TEXT_REPLACEMENTS: Record<string, string> = {
  // Connectors screen – bottom link
  "I don't have a wallet": 'Get MetaMask',
  // Onboarding screen – heading (shown after clicking "I don't have a wallet")
  'Get a Wallet': 'Get MetaMask',
  // Onboarding screen – title
  'Start Exploring Web3': 'Download MetaMask',
  // Onboarding screen – body
  'Your wallet is the gateway to all things Ethereum, the magical technology that makes it possible to explore web3.':
    'MetaMask is the most popular Ethereum wallet. Install it as a browser extension or mobile app to get started.',
  // Onboarding screen – CTA button
  'Choose Your First Wallet': 'Download MetaMask',
};

function replaceTextInNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    if (text && TEXT_REPLACEMENTS[text]) {
      node.textContent = TEXT_REPLACEMENTS[text];
    }
    return;
  }
  for (const child of Array.from(node.childNodes)) {
    replaceTextInNode(child);
  }
}

export default function ConnectKitTextOverrides() {
  useEffect(() => {
    let observer: MutationObserver | null = null;
    let rafId: number | null = null;

    function start() {
      const container = document.getElementById('__CONNECTKIT__');
      if (!container) {
        // Portal not yet mounted – poll on next animation frame
        rafId = requestAnimationFrame(start);
        return;
      }

      // Initial sweep
      replaceTextInNode(container);

      // Watch for DOM mutations (ConnectKit re-renders on route changes)
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const added of Array.from(mutation.addedNodes)) {
            replaceTextInNode(added);
          }
          if (
            mutation.type === 'characterData' &&
            mutation.target.textContent &&
            TEXT_REPLACEMENTS[mutation.target.textContent]
          ) {
            mutation.target.textContent =
              TEXT_REPLACEMENTS[mutation.target.textContent];
          }
        }
      });

      observer.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    start();

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, []);

  return null;
}
