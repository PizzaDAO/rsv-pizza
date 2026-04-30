import { useEffect } from 'react';

/**
 * ConnectKit v1.9.2 does not expose a locale-override API, so we use a
 * MutationObserver on the portal container (#__CONNECTKIT__) to:
 * 1. Replace hard-coded English strings with MetaMask-specific wording
 * 2. Reorder wallets: MetaMask first (when installed)
 * 3. Hide wallets that aren't installed in the browser
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

/** Names of wallets that are currently installed/injected in the browser */
function getInstalledWalletNames(): Set<string> {
  const installed = new Set<string>();
  const eth = (window as any).ethereum;
  if (!eth) return installed;

  // Check main provider
  if (eth.isMetaMask) installed.add('MetaMask');
  if (eth.isCoinbaseWallet) installed.add('Coinbase Wallet');
  if (eth.isPhantom) installed.add('Phantom');
  if (eth.isBraveWallet) installed.add('Brave Wallet');
  if (eth.isRabby) installed.add('Rabby Wallet');

  // Check EIP-6963 multi-provider list
  if (eth.providers && Array.isArray(eth.providers)) {
    for (const p of eth.providers) {
      if (p.isMetaMask) installed.add('MetaMask');
      if (p.isCoinbaseWallet) installed.add('Coinbase Wallet');
      if (p.isPhantom) installed.add('Phantom');
      if (p.isBraveWallet) installed.add('Brave Wallet');
      if (p.isRabby) installed.add('Rabby Wallet');
    }
  }

  return installed;
}

/**
 * ConnectKit renders wallet buttons inside a scrollable container.
 * Each button has the wallet name as text. We:
 * - Move MetaMask to the front (if installed)
 * - Hide non-installed wallets (WalletConnect is always kept as fallback)
 */
function reorderAndFilterWallets(container: Element) {
  // ConnectKit renders buttons inside a grid container within a scroll area.
  // Find all buttons that look like wallet connector buttons.
  const buttons = container.querySelectorAll('button');
  if (buttons.length < 2) return;

  // Group buttons by parent to only process wallet-list containers
  const parentGroups = new Map<Element, HTMLButtonElement[]>();
  buttons.forEach((btn) => {
    const parent = btn.parentElement;
    if (!parent) return;
    if (!parentGroups.has(parent)) parentGroups.set(parent, []);
    parentGroups.get(parent)!.push(btn as HTMLButtonElement);
  });

  const installed = getInstalledWalletNames();
  // WalletConnect is always available (QR-based), keep it visible
  installed.add('WalletConnect');

  for (const [parent, btns] of parentGroups) {
    // Only process groups with 3+ buttons (likely wallet list, not action buttons)
    if (btns.length < 3) continue;

    let metaMaskBtn: HTMLButtonElement | null = null;

    for (const btn of btns) {
      const name = btn.textContent?.replace('Recent', '').trim() || '';

      if (name === 'MetaMask') {
        metaMaskBtn = btn;
      }

      // Hide non-installed wallets
      if (!installed.has(name)) {
        btn.style.display = 'none';
      } else {
        btn.style.display = '';
      }
    }

    // Move MetaMask to the top if installed
    if (metaMaskBtn && installed.has('MetaMask') && parent.firstChild !== metaMaskBtn) {
      parent.insertBefore(metaMaskBtn, parent.firstChild);
    }
  }
}

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

function processContainer(container: Element) {
  replaceTextInNode(container);
  reorderAndFilterWallets(container);
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
      processContainer(container);

      // Watch for DOM mutations (ConnectKit re-renders on route changes)
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const added of Array.from(mutation.addedNodes)) {
            if (added.nodeType === Node.ELEMENT_NODE) {
              processContainer(added as Element);
            } else {
              replaceTextInNode(added);
            }
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
        // Re-run wallet filtering on the whole container after any mutation
        // since ConnectKit may re-render the list
        reorderAndFilterWallets(container);
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
